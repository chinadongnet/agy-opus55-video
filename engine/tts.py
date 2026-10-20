"""Parallel TTS for a project: script.json -> build/voice/*.mp3 + build/voice.json

Usage: python engine/tts.py projects/50mm-portrait [--force] [--jobs 4]
Synthesizes each narration line via Azure Cognitive Services Speech REST API (SSML).
Default voice: zh-CN-XiaoxiaoNeural (style="gentle", rate="0.95", pitch="0%").
Each scene or line in script.json can override: voice, style, styledegree, role, rate, pitch.
Results are cached by content hash.
"""
import asyncio, hashlib, json, os, subprocess, sys, urllib.error, urllib.request
from xml.sax.saxutils import escape as xml_escape

# ---------- Azure Speech Channel Config (F0 · cdh-speech-eastasia-f0) ----------
def _load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_dotenv()

SPEECH_REGION = os.environ.get("SPEECH_REGION", "eastasia")
SPEECH_ENDPOINT = os.environ.get("SPEECH_ENDPOINT", f"https://{SPEECH_REGION}.api.cognitive.microsoft.com/")
SPEECH_KEY = os.environ.get("SPEECH_KEY", "")
TTS_URL = os.environ.get(
    "SPEECH_TTS_URL",
    f"https://{SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1",
)
DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

DEFAULT_VOICE = {
    "name": "zh-CN-XiaoxiaoNeural",
    "style": "gentle",
    "styledegree": None,
    "role": None,
    "rate": "0.95",
    "pitch": "0%",
    "lang": "zh-CN",
    "format": DEFAULT_OUTPUT_FORMAT,
}


def resolve_voice_cfg(base_cfg, override_obj):
    """Merge voice configuration from scene or line into base_cfg."""
    cfg = dict(base_cfg)
    if not isinstance(override_obj, dict):
        return cfg
    v_sub = override_obj.get("voice")
    if isinstance(v_sub, str):
        cfg["name"] = v_sub
    elif isinstance(v_sub, dict):
        for k in ("name", "style", "styledegree", "role", "rate", "pitch", "lang", "format"):
            if v_sub.get(k) is not None:
                cfg[k] = v_sub[k]
    for k in ("style", "styledegree", "role", "rate", "pitch", "lang"):
        if override_obj.get(k) is not None:
            cfg[k] = override_obj[k]
    if override_obj.get("voiceName") is not None:
        cfg["name"] = override_obj["voiceName"]
    return cfg


def line_items(script):
    base_v = dict(DEFAULT_VOICE)
    sv = script.get("voice", {})
    if isinstance(sv, str):
        base_v["name"] = sv
    elif isinstance(sv, dict):
        for k in ("name", "style", "styledegree", "role", "rate", "pitch", "lang", "format"):
            if sv.get(k) is not None:
                base_v[k] = sv[k]

    for sc in script["scenes"]:
        sc_v = resolve_voice_cfg(base_v, sc)
        for j, ln in enumerate(sc.get("lines", [])):
            if isinstance(ln, str):
                ln = {"text": ln}
            ln_v = resolve_voice_cfg(sc_v, ln)
            yield f'{sc["id"]}-{j}', ln.get("say", ln["text"]), ln_v


def build_ssml(text, cfg):
    lang = cfg.get("lang") or "zh-CN"
    voice = cfg.get("name") or DEFAULT_VOICE["name"]
    style = cfg.get("style")
    styledegree = cfg.get("styledegree")
    role = cfg.get("role")
    rate = str(cfg.get("rate") if cfg.get("rate") is not None else "0.95")
    pitch = str(cfg.get("pitch") if cfg.get("pitch") is not None else "0%")
    escaped = xml_escape(text)

    prosody = f'<prosody rate="{rate}" pitch="{pitch}">{escaped}</prosody>'
    if style and str(style).lower() not in ("none", "default", ""):
        attrs = f'style="{style}"'
        if styledegree is not None:
            attrs += f' styledegree="{styledegree}"'
        if role:
            attrs += f' role="{role}"'
        inner = f"<mstts:express-as {attrs}>\n      {prosody}\n    </mstts:express-as>"
    elif role:
        inner = f'<mstts:express-as role="{role}">\n      {prosody}\n    </mstts:express-as>'
    else:
        inner = prosody

    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="{lang}">\n'
        f'  <voice name="{voice}">\n'
        f'    {inner}\n'
        f'  </voice>\n'
        f'</speak>'
    )


def azure_tts_request(ssml, output_format, key, url):
    data = ssml.encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": output_format,
            "User-Agent": "opus55video-tts/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse")


def trim(src, dst, target_dur=None):
    tmp = dst + ".trim.mp3" if target_dur else dst
    subprocess.check_call(["ffmpeg", "-y", "-v", "error", "-i", src, "-af", TRIM, "-c:a", "libmp3lame", "-q:a", "2", tmp])
    if target_dur:
        raw_dur = probe_duration(tmp)
        ratio = raw_dur / target_dur if target_dur > 0 else 1.0
        if abs(raw_dur - target_dur) > 0.02 and 0.5 <= ratio <= 2.0:
            subprocess.check_call([
                "ffmpeg", "-y", "-v", "error", "-i", tmp,
                "-af", f"atempo={ratio:.4f}",
                "-c:a", "libmp3lame", "-q:a", "2", dst,
            ])
            os.remove(tmp)
        else:
            os.replace(tmp, dst)


def probe_duration(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", path]).decode().strip()
    return float(out)


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    no_match = "--no-match-duration" in sys.argv
    jobs = 3
    if "--jobs" in sys.argv:
        jobs = int(sys.argv[sys.argv.index("--jobs") + 1])
    proj = os.path.abspath(args[0])
    script = json.load(open(os.path.join(proj, "script.json"), encoding="utf-8"))

    sv = script.get("voice", {})
    api_key = (sv.get("key") if isinstance(sv, dict) else None) or SPEECH_KEY
    region = (sv.get("region") if isinstance(sv, dict) else None) or SPEECH_REGION
    tts_url = (sv.get("url") if isinstance(sv, dict) else None) or (
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1" if region else TTS_URL
    )

    out_dir = os.path.join(proj, "build", "voice")
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(proj, "build", "voice.json")
    orig_dur_path = os.path.join(proj, "build", "orig_durations.json")
    orig_durs = {}
    if not no_match and os.path.exists(orig_dur_path):
        orig_durs = json.load(open(orig_dur_path, encoding="utf-8"))
    old = {}
    if os.path.exists(manifest_path):
        old = json.load(open(manifest_path, encoding="utf-8"))

    sem = asyncio.Semaphore(jobs)
    result = {}

    async def synth(lid, say, cfg):
        target_dur = orig_durs.get(lid)
        ssml = build_ssml(say, cfg)
        out_fmt = cfg.get("format") or DEFAULT_OUTPUT_FORMAT
        h = hashlib.sha1(f"azure|{ssml}|{out_fmt}|target={target_dur}|trim2".encode("utf-8")).hexdigest()[:12]
        fn = os.path.join(out_dir, f"{lid}_{h}.mp3")
        if not force and os.path.exists(fn) and old.get(lid, {}).get("hash") == h:
            result[lid] = old[lid]
            return
        raw = fn + ".raw.mp3"
        async with sem:
            for attempt in range(8):
                try:
                    audio_bytes = await asyncio.to_thread(azure_tts_request, ssml, out_fmt, api_key, tts_url)
                    with open(raw, "wb") as f:
                        f.write(audio_bytes)
                    break
                except urllib.error.HTTPError as e:
                    if attempt == 7:
                        err_body = ""
                        try:
                            err_body = e.read().decode("utf-8", errors="replace")
                        except Exception:
                            pass
                        raise RuntimeError(f"Azure TTS HTTP {e.code} for {lid}: {err_body}") from e
                    retry_after = e.headers.get("Retry-After") if e.headers else None
                    wait_s = float(retry_after) if (retry_after and str(retry_after).isdigit()) else (3.0 * (attempt + 1) if e.code == 429 else 1.5 * (attempt + 1))
                    await asyncio.sleep(wait_s)
                except Exception:
                    if attempt == 7:
                        raise
                    await asyncio.sleep(1.5 * (attempt + 1))
        await asyncio.to_thread(trim, raw, fn, target_dur)
        os.remove(raw)
        actual_dur = await asyncio.to_thread(probe_duration, fn)
        dur = round(target_dur, 3) if target_dur else round(actual_dur, 3)
        tag = f'{cfg["name"].replace("zh-CN-", "").replace("Neural", "")}:{cfg.get("style") or "default"}@{cfg.get("rate")}'
        result[lid] = {
            "file": os.path.relpath(fn, proj).replace("\\", "/"),
            "duration": dur,
            "hash": h,
            "voice": cfg["name"],
            "style": cfg.get("style"),
            "rate": cfg.get("rate"),
            "pitch": cfg.get("pitch"),
        }
        print(f"  tts {lid:14s} {dur:5.2f}s (actual {actual_dur:5.2f}s)  [{tag}]  {say}")

    await asyncio.gather(*(synth(lid, say, cfg) for lid, say, cfg in line_items(script)))
    json.dump(result, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(r["duration"] for r in result.values())
    print(f"voice lines: {len(result)}  speech total: {total:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())


