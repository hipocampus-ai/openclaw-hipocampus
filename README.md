<div align="center">
  <img src="./assets/banner.jpg" alt="OpenClaw Hipocampus Banner" width="100%" />
</div>

<h1>OpenClaw Hipocampus Plugin</h1>

<p>Production-ready long-term memory for OpenClaw agents.</p>

<h2>What You Get</h2>
<ul>
  <li>Agents remember user preferences across sessions.</li>
  <li>Project decisions stay consistent across multiple agents.</li>
  <li>Memory is scoped to support collaboration and privacy.</li>
  <li>Teams get continuity without changing their OpenClaw workflow.</li>
</ul>

<h2>How It Works</h2>
<ol>
  <li>User sends a message to an OpenClaw agent.</li>
  <li>OpenClaw retrieves relevant memory context.</li>
  <li>The agent responds using current input + recalled context.</li>
  <li>Useful new information is saved for future turns.</li>
</ol>

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant O as OpenClaw Agent
  participant H as Hipocampus Memory

  U->>O: Send message
  O->>H: Recall relevant context
  H-->>O: Return scoped memories
  O-->>U: Respond with grounded answer
  O->>H: Save durable new memory
```

<div align="center">
  <img src="./assets/recall.png" alt="Recall Experience" width="88%" />
</div>

<h2>Input-Output Examples</h2>

<h3>Example 1: Preference Continuity Across Sessions</h3>
<pre><code># Input (Session A)
openclaw agent --local --session-id pref-a --message "I prefer concise responses and local-first workflow."

# Output
Locked in: concise responses, local-first workflow.

# Input (Session B)
openclaw agent --local --session-id pref-b --message "How should you respond and operate for me?"

# Output
- Concise, direct responses.
- Local-first workflow by default.
</code></pre>

<h3>Example 2: Shared Project Decision Across Agents</h3>
<pre><code># Input (Agent alpha)
openclaw agent --local --agent alpha --session-id proj-a --message "Project Orion uses TanStack Query; avoid Redux."

# Output
Saved project decision for Orion.

# Input (Agent beta, same project)
openclaw agent --local --agent beta --session-id proj-b --message "What data layer should we use for Orion?"

# Output
Use TanStack Query and avoid Redux.
</code></pre>

<h3>Tool-Level I/O Sample</h3>
<pre><code>// Input
{
  "tool": "hippocampus_store",
  "params": {
    "text": "User prefers concise responses.",
    "category": "preference",
    "scope": "private"
  }
}

// Output
{
  "content": [
    { "type": "text", "text": "Stored memory: \"User prefers concise responses.\"" }
  ],
  "details": {
    "category": "preference",
    "targets": ["private"]
  }
}
</code></pre>

<h3>Sample Flow: Shared + Private Memory</h3>
```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant A as Agent Alpha
  participant B as Agent Beta
  participant S as Shared Project Memory
  participant PA as Alpha Private Memory
  participant PB as Beta Private Memory

  U->>A: "Project Orion uses TanStack Query."
  A->>S: Save shared project decision
  U->>A: "Keep responses terse."
  A->>PA: Save alpha private preference
  U->>B: "How should we build Orion?"
  B->>S: Recall project decision
  B->>PB: Recall beta private preferences
  B-->>U: "Use TanStack Query." (without alpha-private style)
```

<h2>How It Scales</h2>
<ul>
  <li>Shared project memory aligns all agents on architecture and decisions.</li>
  <li>Private agent memory preserves role-specific preferences and operating style.</li>
  <li>Memory carries across sessions for long-running workstreams.</li>
  <li>Stored knowledge can be updated as new information supersedes old information.</li>
</ul>

<div align="center">
  <img src="./assets/architecture_overview.png" alt="Architecture Overview" width="88%" />
</div>

<h2>Why It Is Production-Ready</h2>
<ul>
  <li>Graceful fallback behavior if memory is temporarily unavailable.</li>
  <li>Scoped memory model to reduce cross-agent leakage.</li>
  <li>Deterministic write behavior to reduce duplicate memory entries.</li>
  <li>Operational tools for store, search, forget, and profile workflows.</li>
</ul>

<div align="center">
  <img src="./assets/structured_event.png" alt="Structured Memory Events" width="88%" />
</div>

<h2>Configuration</h2>
<p>Set <code>HIPPOCAMPUS_OPENCLAW_API_KEY</code> or plugin <code>apiKey</code>.</p>

<pre><code>{
  "plugins": {
    "entries": {
      "openclaw-hipocampus": {
        "enabled": true,
        "config": {
          "apiKey": "${HIPPOCAMPUS_OPENCLAW_API_KEY}",
          "baseUrl": "http://localhost:8080",
          "autoRecall": true,
          "autoCapture": true,
          "sharedBankNameTemplate": "OpenClaw {project_label} Shared Memory",
          "agentBankNameTemplate": "OpenClaw {project_label} {agent_label} Private Memory",
          "maxRecallResults": 10,
          "readjustEnabled": true
        }
      }
    }
  }
}</code></pre>

<h2>Development</h2>
<pre><code>pnpm install
pnpm test
pnpm build</code></pre>

<h2>Smoke Validation</h2>
<ol>
  <li>Start Hippocampus local server (<code>:8080</code>).</li>
  <li>Install plugin into OpenClaw.</li>
  <li>Restart OpenClaw.</li>
  <li>Run preference/project memory scenarios.</li>
</ol>
