# TrustLens

TrustLens is a cyber-focused investigation workspace for:
- document and media forensics,
- deep fact-check research,
- evidence-backed analyst workflows,
- and assistant-driven Q&A over uploaded assets.

It combines a React frontend with a Python FastAPI backend (LangGraph pipeline), and includes a Groq-ready assistant endpoint for file-context chat.

## Table of Contents
- Overview
- Core Modules
- Architecture
- Tech Stack
- Repository Structure
- Quick Start
- Environment Variables
- Running the App
- Feature Walkthrough
- API Endpoints
- Data and Storage
- Troubleshooting
- Security Notes
- Roadmap

## Overview
TrustLens is designed for analysts who need to verify high-risk claims, inspect files, track evidence quality, and produce defensible decisions quickly.

The platform supports:
- URL, image, and document-based fact-check intake,
- deep source gathering and cross-reference workflows,
- forensic metadata and integrity signals for files,
- chat workflows with file attachment context,
- desk-specific operational views (Legal, Compliance, TruthDesk).

## Core Modules

### 1) Dashboard
Operational command center for each desk mode:
- legal,
- compliance,
- truthdesk.

Includes actionable runbooks, SOC launch templates, and quick operations controls.

### 2) Documents
Document/image registry with forensic features:
- metadata visibility,
- trust/risk signals,
- file preview and analyst workflow hooks.

### 3) Fact Check
Deep investigation workspace for:
- URL/article checks,
- image/document checks,
- source collection,
- verdict support,
- recommendation generation.

Backed by a LangGraph pipeline in the backend.

### 4) AI Assistant
GPT-style assistant interface with:
- chat threads,
- From Files picker (attach uploaded app files),
- context-aware replies based on selected file,
- backend chat endpoint ready for Groq.

### 5) Infantry
Operational forensic lane for remediation and evidence actions.

### 6) Resources
Profile and settings surfaces for workspace configuration.

### 7) Authentication and Identity
- Login and signup flows
- Profile initialization
- Face sample capture and verification signals
- Session continuity across desk modules

## Architecture

### Frontend
- React + TypeScript + Vite
- shadcn/ui components
- localStorage-backed workspace stores

### Backend
- FastAPI service (`backend/factcheck_graph/app.py`)
- LangGraph research pipeline nodes:
  - decomposer
  - planner
  - searcher
  - browser chain
  - critic
  - synthesizer
- assistant chat endpoint with Groq integration fallback support

## Tech Stack
- Frontend: React 18, TypeScript, Vite, Tailwind, shadcn/ui
- Backend: Python, FastAPI, LangGraph
- Optional LLM: Groq Chat Completions API

## Repository Structure

```text
TRUST-LENS-main/
  backend/
    factcheck_graph/
      app.py                # FastAPI + LangGraph + assistant chat endpoint
      requirements.txt
      README.md
  src/
    components/
      InsideDashboard.tsx
      InsideDocuments.tsx
      InsideFactCheck.tsx
      InsideChat.tsx
      InsideInfantry.tsx
      InsideRebuild.tsx
    utils/
      factcheckGraphApi.ts  # frontend client for /api/factcheck/run
      assistantApi.ts       # frontend client for /api/factcheck/chat
      inside*Data.ts        # localStorage data stores
  package.json
```

## Quick Start

## Prerequisites
- Node.js 18+
- npm
- Python 3.10+

## Install dependencies
From repository root:

```bash
npm install
```

Backend Python dependencies:

```bash
pip install -r backend/factcheck_graph/requirements.txt
```

## Environment Variables

### Backend (required for Groq-powered assistant answers)
Set in the same terminal session before running backend:

```powershell
$env:GROQ_API_KEY="your_groq_api_key"
$env:GROQ_MODEL="llama-3.1-8b-instant"
```

If not set, assistant still works with deterministic fallback responses.

### Frontend (optional)
- `VITE_FACTCHECK_GRAPH_API` (default: `http://127.0.0.1:8787`)
- `VITE_FACTCHECK_ALLOW_BROWSER_FALLBACK` (`1` enables fallback path in fact-check flow)

Example (PowerShell):

```powershell
$env:VITE_FACTCHECK_GRAPH_API="http://127.0.0.1:8787"
```

## Running the App

### 1) Start backend
From repo root:

```bash
npm run factcheck:api
```

or from `backend/`:

```bash
python -m uvicorn factcheck_graph.app:app --host 127.0.0.1 --port 8787
```

### 2) Start frontend
From repo root (new terminal):

```bash
npm run dev
```

### 3) Open app
Use the local Vite URL shown in terminal (usually `http://localhost:8080` in this project setup).

## Feature Walkthrough

### A) Fact Check Deep Run
1. Open Fact Check tab.
2. Select input type: URL / Image / Document.
3. Submit source and context.
4. Start deep research.
5. Review:
   - source coverage,
   - Q&A over gathered evidence,
   - recommendations.

### B) AI Assistant with File Context
1. Open AI Assistant tab.
2. Click `From Files`.
3. Select any uploaded document/image from app stores.
4. Ask a question in chat.
5. Assistant sends question + selected file context to backend `/api/factcheck/chat`.

### C) SOC Launch Templates (Dashboard)
Use runbook templates to seed queue items and initiate structured verification flows.

### D) Login and Signup Flow
1. Open authentication screen.
2. New users use signup to create account profile.
3. Existing users login with credentials.
4. User profile seed is stored and mirrored into workspace profile store.
5. App enters desk workspace with role/mode-specific dashboards.

### E) Face Sample / Verification Flow
TrustLens includes face-related onboarding/profile utilities for identity confidence during session usage.

Typical flow:
1. Open profile/face capture area.
2. Capture face sample (camera-based).
3. System stores verification state and profile-linked face flags.
4. Subsequent sessions read verification flag to reflect identity status in profile/workspace.

Relevant code paths:
- `src/components/FaceCapture.tsx`
- `src/utils/faceApi.ts`
- `src/utils/faceUtils.ts`
- `src/utils/insideProfileData.ts`

What this is used for:
- reduce impersonation risk in analyst workflow,
- provide visible identity confidence in profile state,
- support higher-trust internal operations.

## API Endpoints

### `GET /health`
Health check for backend service.

### `POST /api/factcheck/run`
Runs LangGraph deep fact-check pipeline.

Request (example):

```json
{
  "claim": "...",
  "source_url": "https://...",
  "context": "...",
  "input_type": "url",
  "file_name": "optional"
}
```

### `POST /api/factcheck/chat`
Assistant chat endpoint (Groq-backed when configured).

Request (example):

```json
{
  "mode": "truthdesk",
  "question": "What does this file claim?",
  "selected_asset": {
    "id": "doc-123",
    "name": "report.pdf",
    "type": "application/pdf",
    "summary": "reviewing | trust 72 | risks 2",
    "extracted_text": "..."
  },
  "history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

## Data and Storage
Client-side operational state is persisted with localStorage stores in `src/utils/inside*Data.ts`.

Important stores include:
- dashboard store
- documents store
- fact-check store
- chat store
- profile/settings stores

Authentication/profile-adjacent persistence:
- `userProfile` seed object (mirrored from profile updates)
- face verification flags in profile store
- per-desk workspace state retained across sessions

## Troubleshooting

### 1) Assistant shows fallback instead of Groq answers
- Ensure backend terminal has `GROQ_API_KEY` set.
- Restart backend after setting env vars.

### 2) From Files shows no uploads
- Confirm files exist in Documents section.
- Assistant picker falls back to all desks if current desk has none.
- Hard refresh app if localStorage was just updated externally.

### 3) Backend CORS issues
Backend already includes localhost origins for Vite usage. Ensure frontend points to running backend URL.

### 4) Fact-check returns sparse links
- Provide richer context in intake.
- Prefer direct source URL when available.
- Keep backend running (fallback paths are intentionally constrained).

### 5) Login/Profile appears reset
- Check browser storage policies/private mode.
- Confirm `userProfile` and inside profile store are not being cleared.
- Avoid hard-clearing storage unless intentionally resetting workspace.

### 6) Face verification not reflecting in profile
- Re-run face capture in profile flow.
- Ensure camera permissions are allowed.
- Verify profile store updates are firing (`PROFILE_UPDATED_EVENT` path).

## Security Notes
- Do not commit API keys.
- Use environment variables for all secrets.
- Treat uploaded evidence as sensitive; avoid sharing localStorage dumps.

## Roadmap
- Direct tab handoff from dashboard templates into active fact-check sessions
- Multi-file attachment in assistant
- Rich citations in assistant answers
- Server-side persistent storage option
- Role-based access controls

---

If you need deployment docs (Docker/systemd/Windows service setup), add a `docs/deployment.md` and wire environment profiles per stage.
