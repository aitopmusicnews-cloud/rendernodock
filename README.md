# Music Video Studio
[![License](https://img.shields.io/github/license/aitopmusicnews-cloud/rendernodock)](LICENSE)
[![Version](https://img.shields.io/github/v/release/aitopmusicnews-cloud/rendernodock?include_prereleases&label=version)](https://github.com/aitopmusicnews-cloud/rendernodock/releases)

AI-driven timeline generation and video creation for music tracks using LTX-2.3 through modal.com.

## Why This Exists

Music video production often requires manual editing to sync visuals with audio, which is time-consuming and requires specialized skills. This platform automates beat detection, timeline subdivision, and AI video generation to let developers and creators produce synchronized videos quickly.

## Streamlined AI Video Generation Models

The application is fully synchronized to use five active flagship models:
- **Gen-4.5** (flagship · 2–10s)
- **Gen-4 Turbo** (fast · 5 / 10s)
- **SeedDance 2** (high quality · 5–15s)
- **Veo 3.1** (Google · 4 / 6 / 8s)
- **Veo 3.1 Fast** (Google · faster · 4 / 6 / 8s)

*Per-model durations are automatically snapped to acceptable boundaries for each backend API.*

## Prerequisites

- Node.js 18+
- Python 3.9+
- FFmpeg installed

## Installation

```bash
# Clone repository
git clone https://github.com/aitopmusicnews-cloud/rendernodock.git
cd rendernodock

# Install dependencies
pnpm install

# Start services
pnpm run dev
```

## Quickstart

```ts
// Health check
curl http://localhost:3000/health
```

```ts
// Example: Queue status component
import { useState } from 'react';
function QueueStatus() {
  const [status] = useState('idle');
  return <div>Queue Status: {status}</div>;
}
```

## Usage

```ts
// Example: Trigger generation via API
import fastify from 'fastify';
const server = fastify();
server.post('/generate', async (req, reply) => {
  const { audioUrl, model } = req.body;
  // ... generation logic
});
```

```bash
# Upload a song and start procedural fallback
curl -X POST http://localhost:3001/upload \
  -F "file=@/path/to/song.mp3"
```

## Configuration

| Variable | Description |
|----------|-------------|
| `FAL_API_SECRET` | Fal.ai API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `MODAL_AUDIO_URL` | URL for remote audio analysis |
| `MODAL_IMAGE_URL` | URL for remote image generation |
| `MODAL_LIPSYNC_URL` | URL for lip-sync processing |
| `MODAL_LTX_URL` | URL for LTX video generation |
| `PORT` | Server port (default 3001) |
| `PUBLIC_BASE_URL` | Base URL for the deployed app |

## Contributing

Contributions are welcome. Please fork the repository, make your changes, and submit a pull request. Follow the existing code style and add tests for new functionality.

## License

MIT