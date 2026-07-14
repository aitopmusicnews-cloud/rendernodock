# Audio analysis sidecar

Pure analysis logic in `audio_core.py`. Two wrappers:

| Wrapper | When | Entry |
|---|---|---|
| `audio_analysis.py` | Production / Friday probes | Deployed to Modal |
| `local_server.py` | Local dev, no Modal account needed | FastAPI on `:3002` |

Both expose the same `POST /` endpoint that takes `{"url": "...", "sections": 6}` and returns the JSON shape produced by `audio_core.analyze_bytes`. Fastify's `MODAL_AUDIO_URL` env var points at whichever you're running.

## Local dev

```bash
cd modal
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-local.txt
python local_server.py
```

Then in repo-root `.env`:

```
MODAL_AUDIO_URL=http://localhost:3002
```

## Modal deploy

```bash
modal token new            # one-time auth
modal deploy audio_analysis.py
```

Modal prints a URL like `https://<workspace>--music-video-studio-audio-analyze.modal.run`. Save it to `.env` as `MODAL_AUDIO_URL`.

For iterative dev against Modal infra (hot reload, temp URL):

```bash
modal serve audio_analysis.py
```

## Test either path

```bash
curl -X POST $MODAL_AUDIO_URL \
    -H 'content-type: application/json' \
    -d '{"url": "https://example.com/song.mp3"}' | jq .
```

The shape:

```json
{
  "duration": 200.5,
  "bpm": 102.3,
  "key": "A",
  "beats": [0.5, 1.05, 1.6, ...],
  "downbeats": [0.5, 2.4, ...],
  "onsets": [...],
  "rms_curve": [0.12, 0.18, ...],
  "sections": [{"start": 0.0, "end": 12.4, "label": "section 1"}, ...]
}
```

## Roadmap

- v1 (now): librosa BPM/beats/onsets/RMS/key + agglomerative section boundaries (no labels).
- v2: swap section detection for [`allin1`](https://github.com/mir-aidj/all-in-one) — gives `intro/verse/chorus/bridge` labels. GPU-friendly. Modal-only path makes sense once it's heavy.
- v3: lyric alignment via [`whisperX`](https://github.com/m-bain/whisperX) when LRCLib has no match.
