# 🎬 Music Video Studio (MVS)

A production-ready full-stack workspace designed for creating high-fashion, high-performance music videos driven by AI generation and audio-reactive visualization. MVS empowers artists and editors to choreograph video sequences that lock seamlessly onto audio beats, integrate custom avatars, and render finished high-fidelity videos.

---

## ✨ Features

### 🎧 Audio-Reactive Pipeline
- **Smart Beat Grid**: Real-time analysis tracks BPM, key signatures, beat timings, downbeats, and onsets.
- **Rhythmic Waveform Visualizer**: Interlock-driven WaveSurfer interface rendering audio tracks with dynamic zoom controls.
- **Graceful Asset Alerts**: Automatic 404 recovery overlays triggering quick-action re-upload buttons for expired or unresolvable temporal audio files.

### 🎥 Multi-Track Creative Timeline
- **Precise Sequencing**: Segment, split, merge, and trim blocks directly on the timeline.
- **Transition Bridging**: Supports cross-scene bridges on compatible generation models to blend contiguous clips seamlessly.
- **Dynamic Render Controls**: Preview output directly in real-time or schedule asynchronous cloud rendering jobs.

### 🤖 Generative AI Suite
- **Custom Character System & LipSync**: Select or upload lookbook models, pick interactive virtual avatars, and execute automated LipSync tasks aligned with vocal tracks.
- **Multimodal Generation**: Powered entirely by custom Modal services running LTX-Video v2.3 for video generation, as well as specialized audio processing and rendering.

---

## 📂 Project Architecture

The workspace utilizes a monorepo structure separating the frontend, backend, and core types:

```text
├── apps/
│   ├── api/                   # Fastify backend, storage routing, and generation coordinators
│   │   ├── src/
│   │   │   ├── config.ts      # Strict Zod environment variable parser
│   │   │   ├── server.ts      # API endpoints, upload routing, and middleware
│   │   │   └── storage.ts     # Local disk or S3/CloudFront bucket storage interfaces
│   │   └── storage/           # Local storage fallback directory
│   │
│   └── web/                   # React SPA, Tailwind styling, and timeline UI components
│       ├── src/
│       │   ├── components/    # Timeline, Sidebar, Header, Waveform, and Library components
│       │   ├── routes/        # Router configuration and Main Editor workspace
│       │   └── styles/        # Global CSS with cyber-organic slate design variables
│       └── package.json
│
├── packages/
│   └── shared/                # Common schemas (Zod) and shared types ensuring full-stack type safety
│       └── src/index.ts
│
├── package.json               # Root monorepo workspace configuration
├── tsconfig.json              # Shared TypeScript base configuration
└── tailwind.config.js         # Unified tailwind utility definitions
```

---

## 🚀 Getting Started

### 📋 Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** or **bun** for dependency management

### ⚙️ Environment Configuration

1. Copy the environment variables template to your local `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in the required credentials:
   - Provide `MODAL_LTX_URL` to point to your custom LTX-Video v2.3 deployment on Modal.
   - Adjust `STORAGE_BACKEND` (`local` for fast offline development, or `s3` for permanent storage).

---

## ⚡ Complete Modal Pipeline Setup

To run the fully functional audio-reactive and video generation pipeline, you must deploy the custom Python microservices located in the `/modal` folder to your **Modal** workspace. This pipeline operates with zero external APIs (no Fal.ai or OpenRouter dependencies).

### 1. Initialize and Authenticate Modal
```bash
cd modal
python -m venv .venv
source .venv/bin/activate
pip install modal fastapi httpx
modal token new
```

### 2. Deploying the Microservices
Deploy all three core modules to the Modal cloud:

* **Audio Analysis Worker** (Processes beats, key, BPM, and transients):
  ```bash
  modal deploy audio_analysis.py
  ```
  *Save the printed URL into your `.env` as `MODAL_AUDIO_URL`.*

* **LTX-Video v2.3 Worker** (Generates 24fps joint audio-video clips on an **A100-80GB GPU**):
  ```bash
  modal deploy ltx_video.py
  ```
  *Save the printed endpoint URL into your `.env` as `MODAL_LTX_URL`.*

* **Media Suite Worker** (Text-to-Image / Lip Sync worker on an **A10G GPU**):
  ```bash
  modal deploy media_suite.py
  ```

### 3. Verify in `.env` Config
Your project root `.env` should look like this:
```env
MODAL_AUDIO_URL=https://<your-workspace>--mvs-audio-analyze.modal.run
MODAL_LTX_URL=https://<your-workspace>--mvs-ltx-video-generate.modal.run
```

---

### 🛠️ Development & Production Workflows

* **Install dependencies** across the entire workspace:
  ```bash
  npm install
  ```

* **Run the application** (runs both backend API on `3001` and Vite dev server on `3000` concurrently):
  ```bash
  npm run dev
  ```

* **Build for production**:
  ```bash
  npm run build
  ```

* **Run code checks & type verification**:
  ```bash
  npm run lint
  ```

---

## 🎨 Visual Identity

MVS uses an eye-safe, high-contrast dark visual design system themed around a **Cyber-Organic slate** aesthetic:
- **Obsidian Dark Canvas**: Deep blacks and slate grays maximize visual focus on content previews.
- **Stark Metallic accents**: High-fashion minimal boarders and razor-thin margins keep panels tidy.
- **Intense Amber Highlights**: Neon orange indicators (`#ff6b00`) illuminate active playheads, rendering progresses, and timeline highlights in rhythm with the sound.
