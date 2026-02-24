<div align="center">
  <img src="./assets/banner.jpg" alt="OpenClaw Hipocampus Banner" width="100%" />
</div>

<h1>OpenClaw Hipocampus Plugin</h1>

<p>Production-oriented memory plugin for OpenClaw backed by Hippocampus.</p>

<h2>Features</h2>
<ul>
  <li>Automatic recall on <code>before_agent_start</code></li>
  <li>Automatic capture on <code>agent_end</code></li>
  <li>Single-pass <code>use|readjust</code> routing (no second recall call)</li>
  <li>Project + Agent hybrid routing (<code>shared</code> + <code>private</code> banks)</li>
  <li>Tool parity:
    <ul>
      <li><code>hippocampus_store</code></li>
      <li><code>hippocampus_search</code></li>
      <li><code>hippocampus_forget</code></li>
      <li><code>hippocampus_profile</code></li>
    </ul>
  </li>
</ul>

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
          "readjustEnabled": true,
          "readjustConfidenceThreshold": 0.62
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
