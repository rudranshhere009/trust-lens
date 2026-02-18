# TrustLens FactCheck Graph API

LangGraph/LangChain-backed research API implementing:

- `Decomposer -> Planner -> Searcher -> Browser chain -> Critic -> Synthesizer`
- aggressive link chaining (target 25-35 sources)
- pivot query strategy when results are shallow/circular
- final verdict + sub-claim table + confidence + gaps

## Run

```bash
pip install -r backend/factcheck_graph/requirements.txt
python -m uvicorn backend.factcheck_graph.app:app --host 127.0.0.1 --port 8787
```

or from npm script:

```bash
npm run factcheck:api
```

## Frontend Integration

Set optional env var:

```bash
VITE_FACTCHECK_GRAPH_API=http://127.0.0.1:8787
```

If not set, frontend defaults to `http://127.0.0.1:8787`.

Optional:

```bash
VITE_FACTCHECK_ALLOW_BROWSER_FALLBACK=1
```

By default, browser fallback is disabled so CORS-blocked public endpoints do not pollute runs.

Endpoint used:

- `POST /api/factcheck/run`
- `GET /health`
