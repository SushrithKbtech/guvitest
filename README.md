# GUVI Honeypot Endpoint Tester

Node.js tester that simulates a scammer and evaluates honeypot API behavior through multi-turn conversations.

## Setup

```bash
cd guvi-tester
npm install
```

Edit `.env` as needed:

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
LLM_PROVIDER=openai
HONEYPOT_URL=http://localhost:3000/api/conversation
HONEYPOT_API_KEY=honeypot-guvi-2026-secure-key
SCENARIO=bank-fraud
TURNS=12
HOST=0.0.0.0
PORT=8080
PUBLIC_BASE_URL=http://192.168.1.10:8080
```

## Run (Web UI)

```bash
npm start
```

Open `http://localhost:8080` (or your LAN IP) in a browser.

## Run (CLI)

```bash
npm run cli -- --url http://localhost:3000/api/conversation --key honeypot-guvi-2026-secure-key --scenario bank-fraud --turns 12
```

## Callback Endpoint

The tester exposes `POST /callback` (configurable via `CALLBACK_PATH`).
Set `PUBLIC_BASE_URL` to your LAN IP for callbacks from a remote honeypot server.

## Logs

Conversation logs are saved to `logs/<sessionId>.json`.
