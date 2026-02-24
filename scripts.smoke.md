# Local Smoke Runbook

## 1) Build and install plugin

```bash
cd openclaw-hipocampus
pnpm install
pnpm build
```

Install/update in OpenClaw according to your plugin flow.

## 2) Restart OpenClaw

Restart in the same terminal session where OpenClaw is running.

## 3) Verify Hippocampus health

```bash
curl -sS http://127.0.0.1:8080/v1/health
```

## 4) Smoke scenario A (preference persistence)

1. In session A, tell agent: "I prefer concise responses and local-first workflow."
2. Start session B and ask: "How should you respond and operate?"
3. Expect memory-aware answer.

## 5) Smoke scenario B (shared project memory)

1. Agent A: "Project Atlas uses TanStack Query; avoid Redux."
2. Agent B (same project): ask for implementation approach.
3. Expect shared decision recalled.

## 6) Smoke scenario C (agent isolation)

1. Agent A: set private behavior preference.
2. Agent B: verify that private preference does not leak.

