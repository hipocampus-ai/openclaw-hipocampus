// src/utils.ts
import { createHash } from "crypto";
function hashText(input) {
  return createHash("sha256").update(input).digest("hex");
}
function buildDeterministicIdempotencyKey(turn, content, suffix) {
  const hash = hashText(`${content}:${suffix}`).slice(0, 12);
  return `oc:${turn.projectId}:${turn.agentId}:${turn.sessionId}:${turn.turnId}:${hash}`;
}
function renderTemplate(template, vars) {
  return template.replace(/\{\{?([a-zA-Z0-9_]+)\}?\}/g, (_m, key) => {
    return vars[key] ?? "";
  });
}
function toIsoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function normalizeWeights(input) {
  const sum = Object.values(input).reduce((acc, v) => acc + Math.max(0, v), 0);
  if (sum <= 0) {
    const keys = Object.keys(input);
    const even = 1 / keys.length;
    const out2 = { ...input };
    for (const k of keys) {
      out2[k] = even;
    }
    return out2;
  }
  const out = { ...input };
  for (const [k, v] of Object.entries(input)) {
    out[k] = Math.max(0, v) / sum;
  }
  return out;
}
function jitterSleepMs(baseMs, attempt) {
  const cap = Math.min(8e3, baseMs * 2 ** attempt);
  const jitter = cap * (0.2 + Math.random() * 0.3);
  return new Promise((resolve) => setTimeout(resolve, Math.round(cap + jitter)));
}

// src/banks.ts
var DEFAULT_CACHE_TTL_MS = 5 * 60 * 1e3;
var BankResolver = class {
  client;
  cfg;
  logger;
  cache = /* @__PURE__ */ new Map();
  bankIdToKey = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Map();
  cacheTtlMs;
  constructor(client, cfg, logger, options) {
    this.client = client;
    this.cfg = cfg;
    this.logger = logger;
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }
  async resolveForTurn(turn) {
    const inflightKey = `${turn.projectId}::${turn.agentId}`;
    const existing = this.inFlight.get(inflightKey);
    if (existing) return existing;
    const task = this.resolveForTurnInternal(turn).finally(() => {
      this.inFlight.delete(inflightKey);
    });
    this.inFlight.set(inflightKey, task);
    return task;
  }
  async resolveForTurnInternal(turn) {
    const now = Date.now();
    const sharedKey = this.sharedKey(turn);
    const privateKey = this.privateKey(turn);
    const cachedShared = this.cache.get(sharedKey);
    const cachedPrivate = this.cache.get(privateKey);
    if (cachedShared && cachedPrivate && cachedShared.expiresAt > now && cachedPrivate.expiresAt > now) {
      return {
        sharedBankId: cachedShared.bankId,
        privateBankId: cachedPrivate.bankId
      };
    }
    const list = await this.client.listBanks();
    const banks = list.banks ?? [];
    const sharedBankId = this.pickSharedBankId(banks, turn) ?? (await this.createSharedBank(turn)).id;
    const privateBankId = this.pickPrivateBankId(banks, turn) ?? (await this.createPrivateBank(turn)).id;
    this.setCache(sharedKey, sharedBankId);
    this.setCache(privateKey, privateBankId);
    return { sharedBankId, privateBankId };
  }
  invalidateForTurn(turn) {
    this.cache.delete(this.sharedKey(turn));
    this.cache.delete(this.privateKey(turn));
  }
  invalidateByBankId(bankId) {
    const key = this.bankIdToKey.get(bankId);
    if (key) {
      this.cache.delete(key);
      this.bankIdToKey.delete(bankId);
    }
  }
  sharedKey(turn) {
    return `${turn.projectId}::shared`;
  }
  privateKey(turn) {
    return `${turn.projectId}::agent::${turn.agentId}`;
  }
  setCache(key, bankId) {
    this.cache.set(key, {
      bankId,
      expiresAt: Date.now() + this.cacheTtlMs
    });
    this.bankIdToKey.set(bankId, key);
  }
  pickSharedBankId(banks, turn) {
    const shared = banks.filter((b) => String(b.metadata?.routing_role ?? "") === "shared");
    if (shared.length === 0) return void 0;
    const exactProject = shared.find(
      (b) => String(b.metadata?.project_id ?? "") === turn.projectId
    );
    if (exactProject) return exactProject.id;
    const sameSource = shared.find(
      (b) => String(b.metadata?.source ?? "") === "openclaw-hipocampus"
    );
    if (sameSource) return sameSource.id;
    return shared[0]?.id;
  }
  pickPrivateBankId(banks, turn) {
    const privateBanks = banks.filter(
      (b) => String(b.metadata?.routing_role ?? "") === "agent_private" && String(b.metadata?.agent_id ?? "") === turn.agentId
    );
    if (privateBanks.length === 0) return void 0;
    const exactProject = privateBanks.find(
      (b) => String(b.metadata?.project_id ?? "") === turn.projectId
    );
    if (exactProject) return exactProject.id;
    const sameSource = privateBanks.find(
      (b) => String(b.metadata?.source ?? "") === "openclaw-hipocampus"
    );
    if (sameSource) return sameSource.id;
    return privateBanks[0]?.id;
  }
  createSharedBank(turn) {
    this.logger.info(
      `creating shared bank for project=${turn.projectId} tenant=${turn.tenantId}`
    );
    return this.client.createBank({
      name: this.sharedBankName(turn),
      background: "OpenClaw shared project memory",
      disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      metadata: {
        routing_role: "shared",
        project_id: turn.projectId,
        tenant_id: turn.tenantId,
        source: "openclaw-hipocampus"
      }
    });
  }
  createPrivateBank(turn) {
    this.logger.info(
      `creating private bank for project=${turn.projectId} agent=${turn.agentId}`
    );
    return this.client.createBank({
      name: this.privateBankName(turn),
      background: "OpenClaw private agent memory",
      disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      metadata: {
        routing_role: "agent_private",
        project_id: turn.projectId,
        tenant_id: turn.tenantId,
        agent_id: turn.agentId,
        source: "openclaw-hipocampus"
      }
    });
  }
  sharedBankName(turn) {
    return renderTemplate(this.cfg.sharedBankNameTemplate, this.templateVars(turn));
  }
  privateBankName(turn) {
    return renderTemplate(this.cfg.agentBankNameTemplate, this.templateVars(turn));
  }
  templateVars(turn) {
    return {
      tenant_id: turn.tenantId,
      project_id: turn.projectId,
      agent_id: turn.agentId,
      session_id: turn.sessionId,
      tenant_label: toHumanLabel(turn.tenantId, "Tenant"),
      project_label: toHumanLabel(turn.projectId, "Project"),
      agent_label: toHumanLabel(turn.agentId, "Agent"),
      session_label: toHumanLabel(turn.sessionId, "Session")
    };
  }
};
function toHumanLabel(input, fallback) {
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  if (/^(proj|tenant|sess)_[a-f0-9]{12,}$/i.test(raw)) {
    return fallback;
  }
  const cleaned = raw.replace(/^oc::/i, "").replace(/[_:.-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.split(" ").map((word) => {
    if (/^[A-Z0-9]+$/.test(word)) return word;
    if (word.length <= 2) return word.toUpperCase();
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

// src/types.ts
var HippocampusHttpError = class extends Error {
  status;
  method;
  path;
  body;
  constructor(message, options) {
    super(message);
    this.name = "HippocampusHttpError";
    this.status = options.status;
    this.method = options.method;
    this.path = options.path;
    this.body = options.body;
  }
};

// src/client.ts
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
function isRetryableError(error) {
  if (error instanceof HippocampusHttpError) {
    return isRetryableStatus(error.status);
  }
  return true;
}
var ALLOWED_MEMORY_TYPES = /* @__PURE__ */ new Set([
  "world",
  "experience",
  "opinion",
  "observation"
]);
var HippocampusClient = class {
  baseUrl;
  apiKey;
  recallTimeoutMs;
  rememberTimeoutMs;
  requestRetryAttempts;
  logger;
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.recallTimeoutMs = options.recallTimeoutMs;
    this.rememberTimeoutMs = options.rememberTimeoutMs;
    this.requestRetryAttempts = options.requestRetryAttempts;
    this.logger = options.logger;
  }
  async listBanks() {
    return this.requestWithPathFallback(
      "GET",
      "/banks",
      "/v1/banks",
      void 0,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts
      }
    );
  }
  async createBank(payload) {
    return this.requestWithPathFallback(
      "POST",
      "/banks",
      "/v1/banks",
      payload,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts
      }
    );
  }
  async remember(bankId, payload) {
    if (payload.memory_type && !ALLOWED_MEMORY_TYPES.has(payload.memory_type)) {
      throw new Error(
        `Unsupported memory_type '${payload.memory_type}'. Allowed: world|experience|opinion|observation`
      );
    }
    return this.requestWithPathFallback(
      "POST",
      `/banks/${encodeURIComponent(bankId)}/remember`,
      `/v1/banks/${encodeURIComponent(bankId)}/remember`,
      payload,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts
      }
    );
  }
  async recall(bankId, payload) {
    return this.requestWithPathFallback(
      "POST",
      `/banks/${encodeURIComponent(bankId)}/recall`,
      `/v1/banks/${encodeURIComponent(bankId)}/recall`,
      payload,
      {
        timeoutMs: this.recallTimeoutMs,
        retryAttempts: this.requestRetryAttempts
      }
    );
  }
  async deleteMemory(bankId, memoryId) {
    await this.requestWithPathFallback(
      "DELETE",
      `/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(memoryId)}`,
      `/v1/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(memoryId)}`,
      void 0,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts
      }
    );
    return { ok: true };
  }
  async requestWithPathFallback(method, primaryPath, fallbackPath, payload, options) {
    try {
      return await this.request(method, primaryPath, payload, options);
    } catch (error) {
      if (error instanceof HippocampusHttpError && error.status === 404 && primaryPath !== fallbackPath) {
        this.logger.warn(
          `primary endpoint returned 404 for ${method} ${primaryPath}; retrying with ${fallbackPath}`
        );
        return this.request(method, fallbackPath, payload, options);
      }
      throw error;
    }
  }
  async request(method, path, payload, options) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;
    for (let attempt = 0; attempt <= options.retryAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey
          },
          body: payload == null ? void 0 : JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);
        const text = await response.text();
        const body = text.length > 0 ? safeJsonParse(text) : void 0;
        if (!response.ok) {
          const bodyDetail = summarizeErrorBody(body);
          throw new HippocampusHttpError(
            `Hippocampus request failed: ${method} ${path} -> ${response.status}${bodyDetail ? ` (${bodyDetail})` : ""}`,
            {
              status: response.status,
              method,
              path,
              body
            }
          );
        }
        return body ?? {};
      } catch (error) {
        clearTimeout(timeout);
        lastErr = error;
        if (!isRetryableError(error) || attempt >= options.retryAttempts) {
          throw error;
        }
        this.logger.warn(
          `retrying request ${method} ${path} attempt=${attempt + 1}/${options.retryAttempts}`
        );
        await jitterSleepMs(300, attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
};
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}
function summarizeErrorBody(body) {
  if (!body || typeof body !== "object") return "";
  const candidate = body;
  const msg = (typeof candidate.message === "string" ? candidate.message : void 0) ?? (typeof candidate.error === "string" ? candidate.error : void 0) ?? (typeof candidate.details === "string" ? candidate.details : void 0);
  return msg ?? "";
}

// src/config.ts
var ALLOWED_KEYS = /* @__PURE__ */ new Set([
  "apiKey",
  "baseUrl",
  "autoRecall",
  "autoCapture",
  "maxRecallResults",
  "profileFrequency",
  "routingMode",
  "sharedBankNameTemplate",
  "agentBankNameTemplate",
  "readjustEnabled",
  "readjustConfidenceThreshold",
  "debug",
  "recallTimeoutMs",
  "rememberTimeoutMs",
  "requestRetryAttempts"
]);
function asObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}
function parseBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function parseNum(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function resolveEnvVars(value) {
  return value.replace(/\$\{([^}]+)\}/g, (_m, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}
function parseConfig(raw) {
  const cfg = asObject(raw);
  const unknown = Object.keys(cfg).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(`hippocampus config has unknown keys: ${unknown.join(", ")}`);
  }
  const apiKeyRaw = typeof cfg.apiKey === "string" && cfg.apiKey.length > 0 ? cfg.apiKey : process.env.HIPPOCAMPUS_OPENCLAW_API_KEY;
  const apiKey = apiKeyRaw ? resolveEnvVars(apiKeyRaw) : void 0;
  return {
    apiKey,
    baseUrl: (typeof cfg.baseUrl === "string" && cfg.baseUrl.trim().length > 0 ? cfg.baseUrl : "http://127.0.0.1:8080").replace(/\/$/, ""),
    autoRecall: parseBool(cfg.autoRecall, true),
    autoCapture: parseBool(cfg.autoCapture, true),
    maxRecallResults: Math.max(1, Math.min(50, parseNum(cfg.maxRecallResults, 10))),
    profileFrequency: Math.max(1, parseNum(cfg.profileFrequency, 50)),
    routingMode: "project_agent_hybrid",
    sharedBankNameTemplate: typeof cfg.sharedBankNameTemplate === "string" ? cfg.sharedBankNameTemplate : "OpenClaw {project_label} Shared Memory",
    agentBankNameTemplate: typeof cfg.agentBankNameTemplate === "string" ? cfg.agentBankNameTemplate : "OpenClaw {project_label} {agent_label} Private Memory",
    readjustEnabled: parseBool(cfg.readjustEnabled, true),
    readjustConfidenceThreshold: Math.max(
      0,
      Math.min(1, parseNum(cfg.readjustConfidenceThreshold, 0.62))
    ),
    debug: parseBool(cfg.debug, false),
    recallTimeoutMs: Math.max(1e3, parseNum(cfg.recallTimeoutMs, 1e4)),
    rememberTimeoutMs: Math.max(1e3, parseNum(cfg.rememberTimeoutMs, 1e4)),
    requestRetryAttempts: Math.max(0, Math.min(5, parseNum(cfg.requestRetryAttempts, 2)))
  };
}
var hippocampusConfigSchema = {
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      apiKey: { type: "string" },
      baseUrl: { type: "string" },
      autoRecall: { type: "boolean" },
      autoCapture: { type: "boolean" },
      maxRecallResults: { type: "number", minimum: 1, maximum: 50 },
      profileFrequency: { type: "number", minimum: 1 },
      routingMode: { type: "string", enum: ["project_agent_hybrid"] },
      sharedBankNameTemplate: { type: "string" },
      agentBankNameTemplate: { type: "string" },
      readjustEnabled: { type: "boolean" },
      readjustConfidenceThreshold: { type: "number", minimum: 0, maximum: 1 },
      debug: { type: "boolean" },
      recallTimeoutMs: { type: "number", minimum: 1e3 },
      rememberTimeoutMs: { type: "number", minimum: 1e3 },
      requestRetryAttempts: { type: "number", minimum: 0, maximum: 5 }
    },
    required: []
  },
  parse: parseConfig
};

// src/message.ts
function extractText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block;
    if (b.type === "text" && typeof b.text === "string") {
      chunks.push(b.text);
    }
  }
  return chunks.join("\n").trim();
}
function countUserTurns(messages) {
  return messages.filter((m) => m?.role === "user").length;
}
function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      return extractText(msg.content);
    }
  }
  return "";
}

// src/memory.ts
function inferMemoryCategory(content) {
  const lower = content.toLowerCase();
  if (/(\bproject decision\b|\bproject-level\b|\bshared rule\b|\bshared decision\b|\barchitecture\b|\btech stack\b|\bcanonical\b|\buse\b.+\binstead\b|\bavoid\b)/i.test(
    lower
  )) {
    return "project_decision";
  }
  if (/(\bprivate\b|\bonly this agent\b|\bfor this agent\b|\bagent-only\b|\bpersonal\b)/i.test(
    lower
  )) {
    return "preference";
  }
  if (/(\bi\s+(prefer|like|love|hate|want|need)\b|\bmy\s+preferred\b|\bpreference\b|\balways\b|\bnever\b)/i.test(
    lower
  )) {
    return "preference";
  }
  if (/(\bworkflow\b|\brun\b|\blint\b|\bbuild\b|\bdeploy\b|\btest\b|\blocally\b|\bcommand\b|\btooling\b)/i.test(
    lower
  )) {
    return "workflow";
  }
  return "fact";
}
function categoryToMemoryType(category) {
  switch (category) {
    case "preference":
      return "opinion";
    case "workflow":
      return "experience";
    case "project_decision":
      return "world";
    case "fact":
    default:
      return "world";
  }
}
function confidenceForMemoryType(memoryType) {
  if (memoryType === "opinion") return 0.82;
  return void 0;
}
function categoryTargets(category) {
  switch (category) {
    case "project_decision":
      return ["shared"];
    case "preference":
    case "workflow":
    case "fact":
    default:
      return ["private"];
  }
}
function stripInjectedContext(content) {
  return content.replace(/<hippocampus-context>[\s\S]*?<\/hippocampus-context>\s*/g, "").trim();
}
function toRelativeTime(timestampIso) {
  const date = new Date(timestampIso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const deltaMs = Date.now() - date.getTime();
  const mins = deltaMs / (1e3 * 60);
  if (mins < 30) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  return date.toISOString().slice(0, 10);
}
function isLikelyQuestion(input) {
  const text = input.trim();
  if (!text) return false;
  if (text.includes("?")) return true;
  if (text.endsWith("?")) return true;
  return /^(who|what|when|where|why|how|can|could|would|should|will|do|does|did|is|are|am)\b/i.test(
    text
  );
}
function toSentence(input) {
  const text = input.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (!text) return "";
  const first = text[0].toUpperCase();
  const rest = text.slice(1);
  return `${first}${rest}.`;
}
function parsePreferenceFacts(fragment) {
  const normalized = fragment.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  const match = normalized.match(
    /^i\s+(prefer|like|love|hate|dislike|want|need)\s+(.+)$/i
  );
  if (!match) return [];
  const verb = match[1].toLowerCase();
  const tail = match[2].trim();
  if (!tail) return [];
  const parts = tail.split(/\s*(?:,| and )\s+/i).map((p) => p.trim().replace(/[.;]+$/, "")).filter((p) => p.length >= 2);
  if (parts.length === 0) return [];
  return parts.map((part) => {
    switch (verb) {
      case "prefer":
        return toSentence(`User prefers ${part}`);
      case "like":
      case "love":
        return toSentence(`User likes ${part}`);
      case "hate":
      case "dislike":
        return toSentence(`User dislikes ${part}`);
      case "want":
      case "need":
      default:
        return toSentence(`User wants ${part}`);
    }
  });
}
function cleanMemoryText(input) {
  return input.replace(/\[\[reply_to_current\]\]/g, "").replace(/\[role:[^\]]+\]/g, "").replace(/\[[a-z_]+:end\]/gi, "").replace(/\*\*/g, "").replace(/^[\s*-]+/, "").replace(/\s+/g, " ").trim();
}
function extractAtomicMemories(input) {
  const raw = cleanMemoryText(input);
  if (!raw || isLikelyQuestion(raw)) {
    return [];
  }
  const fragments = raw.split(/\n|[;]+/g).map((f) => cleanMemoryText(f)).filter((f) => f.length >= 8);
  const out = [];
  for (const fragment of fragments) {
    if (isLikelyQuestion(fragment)) continue;
    const prefFacts = parsePreferenceFacts(fragment);
    if (prefFacts.length > 0) {
      out.push(...prefFacts);
      continue;
    }
    const sentence = toSentence(fragment);
    if (sentence.length >= 10) {
      out.push(sentence);
    }
  }
  return [...new Set(out)].slice(0, 6);
}

// src/turn_context.ts
import { randomUUID } from "crypto";
function readString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return void 0;
}
function inferTurnContext(event, ctx) {
  const c = ctx ?? {};
  const tenantId = readString(c, ["tenantId", "workspaceId"]) ?? readString(event, ["tenantId", "workspaceId"]) ?? "default_tenant";
  const projectId = readString(c, ["projectId", "project_id"]) ?? readString(event, ["projectId", "project_id"]) ?? "default_project";
  const agentId = readString(c, ["agentId", "agent_id", "agentName"]) ?? readString(event, ["agentId", "agent_id", "agentName"]) ?? "default_agent";
  const sessionId = readString(c, ["sessionId", "session_id", "sessionKey"]) ?? readString(event, ["sessionId", "session_id", "sessionKey"]) ?? "default_session";
  const turnId = readString(event, ["turnId", "turn_id", "id"]) ?? readString(c, ["turnId", "turn_id"]) ?? randomUUID();
  return {
    tenantId,
    projectId,
    agentId,
    sessionId,
    turnId,
    timestampIso: toIsoNow()
  };
}

// src/hooks/capture.ts
function buildCaptureHandler(options) {
  const { client, cfg, banks, logger, weightProfiles, onTurnContext } = options;
  return async (event, ctx) => {
    const success = Boolean(event.success);
    if (!success || !cfg.autoCapture) return;
    const messages = Array.isArray(event.messages) ? event.messages : [];
    if (messages.length === 0) return;
    const provider = typeof ctx?.messageProvider === "string" ? ctx.messageProvider : "";
    if (provider === "exec-event" || provider === "cron-event") return;
    const turn = inferTurnContext(event, ctx);
    onTurnContext?.(turn);
    let resolved = await banks.resolveForTurn(turn);
    const latestUser = latestUserText(messages);
    const extracted = extractAtomicMemories(
      stripInjectedContext(latestUser).trim()
    );
    if (extracted.length === 0) return;
    const writes = extracted.flatMap((captured) => {
      const category = inferMemoryCategory(captured);
      const targets = categoryTargets(category);
      const memoryType = categoryToMemoryType(category);
      const confidence = confidenceForMemoryType(memoryType);
      return targets.map(async (scope) => {
        const bankId = scope === "shared" ? resolved.sharedBankId : resolved.privateBankId;
        const idempotencyKey = buildDeterministicIdempotencyKey(turn, captured, scope);
        const payload = {
          content: captured,
          memory_type: memoryType,
          confidence,
          timestamp: turn.timestampIso,
          idempotency_key: idempotencyKey,
          metadata: {
            schema_version: "v1",
            tenant_id: turn.tenantId,
            project_id: turn.projectId,
            agent_id: turn.agentId,
            session_id: turn.sessionId,
            turn_id: turn.turnId,
            memory_category: category,
            target_scope: scope,
            source: "openclaw.agent_end"
          }
        };
        try {
          await client.remember(bankId, payload);
        } catch (error) {
          if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
            throw error;
          }
          banks.invalidateByBankId(bankId);
          const refreshed = await banks.resolveForTurn(turn);
          const retryBankId = scope === "shared" ? refreshed.sharedBankId : refreshed.privateBankId;
          resolved = refreshed;
          await client.remember(retryBankId, payload);
        }
      });
    });
    const settled = await Promise.allSettled(writes);
    for (const result of settled) {
      if (result.status === "rejected") {
        logger.warn(`capture write failed: ${String(result.reason)}`);
      }
    }
    if (latestUser) {
      weightProfiles.ingestCorrectionSignal(turn, latestUser);
    }
  };
}

// src/optimizer/single_pass.ts
var INTENT_PRESETS = {
  temporal: { temporal: 0.5, entity: 0.2, meaning: 0.2, path: 0.1 },
  factual: { temporal: 0.25, entity: 0.35, meaning: 0.3, path: 0.1 },
  procedural: { temporal: 0.15, entity: 0.2, meaning: 0.45, path: 0.2 },
  balanced: { temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 }
};
function decideRouteAndSelect(options) {
  const ranked = [...options.candidates].sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return {
      route: "use",
      confidence: 0,
      selected: [],
      reason: "no_candidates"
    };
  }
  const top = ranked[0]?.score ?? 0;
  const fifth = ranked[Math.min(4, ranked.length - 1)]?.score ?? 0;
  const spread = clamp(top - fifth, 0, 1);
  const conflictMap = detectConflicts(ranked);
  const hasStrongConflict = conflictMap.size > 0;
  const confidence = clamp(0.65 * top + 0.35 * spread, 0, 1);
  const shouldReadjust = options.readjustEnabled && (confidence < options.confidenceThreshold || hasStrongConflict);
  if (!shouldReadjust) {
    return {
      route: "use",
      confidence,
      selected: ranked.slice(0, options.maxResults),
      reason: hasStrongConflict ? "conflict_but_high_confidence" : "high_confidence"
    };
  }
  const intent = detectIntent(options.query);
  const preset = INTENT_PRESETS[intent];
  const weights = normalizeWeights({
    temporal: (preset.temporal + options.profile.temporal) / 2,
    entity: (preset.entity + options.profile.entity) / 2,
    meaning: (preset.meaning + options.profile.meaning) / 2,
    path: (preset.path + options.profile.path) / 2
  });
  const rescored = ranked.map((candidate) => {
    const conflictPenalty = conflictMap.has(candidate.id) ? 1 : 0;
    const recencyBonus = computeRecencyBonus(candidate.timestamp);
    const adjusted = weights.temporal * candidate.temporalScore + weights.entity * candidate.entityScore + weights.meaning * candidate.meaningScore + weights.path * candidate.pathScore + 0.15 * candidate.valueMatchScore - 0.4 * conflictPenalty + recencyBonus;
    return {
      candidate,
      adjusted
    };
  }).sort((a, b) => b.adjusted - a.adjusted).map((item) => item.candidate);
  return {
    route: "readjust",
    confidence,
    selected: rescored.slice(0, options.maxResults),
    reason: hasStrongConflict ? "conflict" : `low_confidence_${intent}`
  };
}
function detectIntent(query) {
  const q = query.toLowerCase();
  if (/(when|latest|recent|today|yesterday|before|after|timeline|changed)/i.test(q)) {
    return "temporal";
  }
  if (/(how|steps|implement|build|run|deploy|procedure)/i.test(q)) {
    return "procedural";
  }
  if (/(who|what|which|name|owner|person|entity|preference)/i.test(q)) {
    return "factual";
  }
  return "balanced";
}
function detectConflicts(candidates) {
  const bySubject = /* @__PURE__ */ new Map();
  for (const candidate of candidates.slice(0, 12)) {
    const claim = extractClaim(candidate.content);
    if (!claim) continue;
    const subjectMap = bySubject.get(claim.subject) ?? /* @__PURE__ */ new Map();
    const ids = subjectMap.get(claim.predicate) ?? [];
    ids.push(candidate.id);
    subjectMap.set(claim.predicate, ids);
    bySubject.set(claim.subject, subjectMap);
  }
  const conflictIds = /* @__PURE__ */ new Set();
  for (const predicates of bySubject.values()) {
    if (predicates.size <= 1) continue;
    for (const ids of predicates.values()) {
      for (const id of ids) {
        conflictIds.add(id);
      }
    }
  }
  return conflictIds;
}
function extractClaim(content) {
  const match = content.match(/\b([A-Z][a-zA-Z0-9_'-]{1,40})\b\s+(?:is|are|was|were)\s+([^.,;]+)/);
  if (!match) return null;
  return {
    subject: match[1].toLowerCase(),
    predicate: match[2].trim().toLowerCase()
  };
}
function computeRecencyBonus(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = (Date.now() - date.getTime()) / (1e3 * 60 * 60 * 24);
  return clamp(1 - ageDays / 365, 0, 1) * 0.05;
}

// src/hooks/recall.ts
function buildRecallHandler(options) {
  const { client, cfg, banks, logger, weightProfiles, onTurnContext } = options;
  return async (event, ctx) => {
    const prompt = typeof event.prompt === "string" ? event.prompt.trim() : "";
    if (!prompt) return;
    const turn = inferTurnContext(event, ctx);
    onTurnContext?.(turn);
    let resolved = await banks.resolveForTurn(turn);
    const weights = weightProfiles.get(turn);
    const basePayload = {
      query: prompt,
      k_results: Math.max(cfg.maxRecallResults * 2, cfg.maxRecallResults),
      k_per_strategy: 15,
      temporal_weight: weights.temporal,
      entity_weight: weights.entity,
      meaning_weight: weights.meaning,
      path_weight: weights.path,
      rerank: true,
      query_intent_mode: "auto",
      temporal_supersession_enabled: true,
      consistency_mode: "strong"
    };
    const [privateResults, sharedResults] = await Promise.all([
      recallForScope({
        scope: "private",
        bankId: resolved.privateBankId,
        payload: basePayload,
        turn,
        resolved,
        client,
        banks,
        logger
      }),
      recallForScope({
        scope: "shared",
        bankId: resolved.sharedBankId,
        payload: basePayload,
        turn,
        resolved,
        client,
        banks,
        logger
      })
    ]);
    const merged = dedupeMemories([...privateResults, ...sharedResults]);
    const decision = decideRouteAndSelect({
      query: prompt,
      candidates: merged,
      maxResults: cfg.maxRecallResults,
      profile: weights,
      confidenceThreshold: cfg.readjustConfidenceThreshold,
      readjustEnabled: cfg.readjustEnabled
    });
    logger.debug(
      `recall route=${decision.route} confidence=${decision.confidence.toFixed(3)} reason=${decision.reason}`
    );
    if (decision.selected.length === 0) {
      return;
    }
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const turns = countUserTurns(messages);
    const includeProfile = turns <= 1 || turns % cfg.profileFrequency === 0;
    const context = formatContext(decision.selected, includeProfile);
    if (!context) return;
    return { prependContext: context };
  };
}
async function recallForScope(options) {
  const { scope, payload, turn, client, banks, logger } = options;
  let bankId = options.bankId;
  const run = async (targetBankId) => {
    const response = await client.recall(targetBankId, payload);
    const mapped = (response.memories ?? []).map((item) => ({
      id: item.memory.id,
      content: item.memory.content,
      memoryType: item.memory.memory_type,
      timestamp: item.memory.timestamp,
      score: item.score ?? 0,
      temporalScore: item.temporal_score ?? 0,
      entityScore: item.entity_score ?? 0,
      meaningScore: item.meaning_score ?? 0,
      pathScore: item.path_score ?? 0,
      valueMatchScore: item.value_match_score ?? 0,
      strategies: item.strategies ?? [],
      bankId: item.memory.bank_id,
      bankScope: scope,
      metadata: item.memory.provenance ?? void 0
    }));
    return filterScopeMemories(mapped, scope);
  };
  try {
    return await run(bankId);
  } catch (error) {
    if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
      logger.warn(`recall failed for ${scope} bank_id=${bankId}: ${String(error)}`);
      return [];
    }
    logger.warn(`bank not found during recall for ${scope}; invalidating cache and retrying once`);
    banks.invalidateByBankId(bankId);
    const refreshed = await banks.resolveForTurn(turn);
    bankId = scope === "shared" ? refreshed.sharedBankId : refreshed.privateBankId;
    try {
      return await run(bankId);
    } catch (retryError) {
      logger.warn(
        `recall retry failed for ${scope} bank_id=${bankId}: ${String(retryError)}`
      );
      return [];
    }
  }
}
function filterScopeMemories(memories, scope) {
  if (scope !== "shared") return memories;
  return memories.filter((memory) => {
    const targetScope = readTargetScope(memory.metadata);
    if (targetScope && targetScope !== "shared") {
      return false;
    }
    const category = inferMemoryCategory(memory.content);
    return category === "project_decision" || category === "fact";
  });
}
function readTargetScope(metadata) {
  if (!metadata) return void 0;
  const value = metadata.target_scope;
  return typeof value === "string" ? value : void 0;
}
function dedupeMemories(memories) {
  const best = /* @__PURE__ */ new Map();
  for (const memory of memories) {
    const existing = best.get(memory.id);
    if (!existing || memory.score > existing.score) {
      best.set(memory.id, memory);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
function formatContext(memories, includeProfile) {
  const staticFacts = [];
  const dynamicFacts = [];
  for (const memory of memories) {
    const category = inferMemoryCategory(memory.content);
    if (category === "preference" || category === "project_decision") {
      staticFacts.push(memory.content);
    } else {
      dynamicFacts.push(memory.content);
    }
  }
  const sections = [];
  if (includeProfile && staticFacts.length > 0) {
    sections.push(
      "## Persistent Preferences/Decisions\n" + staticFacts.slice(0, 8).map((s) => `- ${s}`).join("\n")
    );
  }
  if (includeProfile && dynamicFacts.length > 0) {
    sections.push(
      "## Recent Context\n" + dynamicFacts.slice(0, 8).map((s) => `- ${s}`).join("\n")
    );
  }
  const relevant = memories.slice(0, 12).map((m) => {
    const time = toRelativeTime(m.timestamp);
    const score = Math.round(m.score * 100);
    return `- [${time}] ${m.content} (${score}%)`;
  });
  if (relevant.length > 0) {
    sections.push("## Relevant Memories\n" + relevant.join("\n"));
  }
  if (sections.length === 0) {
    return null;
  }
  return [
    "<hippocampus-context>",
    "The following long-term memory context is for grounding. Use it only when relevant to the user request.",
    "",
    ...sections,
    "",
    "Do not proactively mention memory unless it is directly useful for the current request.",
    "</hippocampus-context>"
  ].join("\n");
}

// src/logger.ts
var noop = () => {
};
function createLogger(raw, debugEnabled) {
  const logger = raw && typeof raw === "object" ? raw : {};
  const info = typeof logger.info === "function" ? logger.info : console.log;
  const warn = typeof logger.warn === "function" ? logger.warn : console.warn;
  const error = typeof logger.error === "function" ? logger.error : console.error;
  const debug = debugEnabled && typeof logger.debug === "function" ? logger.debug : debugEnabled ? console.debug : noop;
  return { info, warn, error, debug };
}

// src/state/weight_profiles.ts
var DEFAULT_PROFILE = {
  temporal: 0.3,
  entity: 0.3,
  meaning: 0.2,
  path: 0.2
};
var WeightProfiles = class {
  profiles = /* @__PURE__ */ new Map();
  get(turn) {
    const key = this.key(turn);
    return this.profiles.get(key) ?? { ...DEFAULT_PROFILE };
  }
  ingestCorrectionSignal(turn, userText) {
    const signal = detectCorrectionSignal(userText);
    if (!signal) return;
    queueMicrotask(() => {
      const current = this.get(turn);
      const next = applySignal(current, signal);
      this.profiles.set(this.key(turn), next);
    });
  }
  key(turn) {
    return `${turn.projectId}::${turn.agentId}`;
  }
};
function detectCorrectionSignal(text) {
  const lower = text.toLowerCase();
  if (!/(wrong|incorrect|not right|i said|that's not|that is not)/i.test(lower)) {
    return null;
  }
  if (/(latest|recent|outdated|now|no longer|changed|today|yesterday|when)/i.test(lower)) {
    return "temporal";
  }
  if (/(who|name|person|team|owner|entity)/i.test(lower)) {
    return "entity";
  }
  if (/(how|steps|implement|build|run|deploy|procedure)/i.test(lower)) {
    return "procedural";
  }
  return "generic";
}
function applySignal(profile, signal) {
  const delta = 0.05;
  const next = { ...profile };
  switch (signal) {
    case "temporal":
      next.temporal += delta;
      next.meaning -= delta / 2;
      next.path -= delta / 2;
      break;
    case "entity":
      next.entity += delta;
      next.meaning -= delta / 2;
      next.path -= delta / 2;
      break;
    case "procedural":
      next.path += delta;
      next.meaning += delta / 2;
      next.temporal -= delta / 2;
      break;
    case "generic":
      next.meaning += delta;
      next.entity += delta / 2;
      next.temporal -= delta / 2;
      break;
    default:
      return normalizeWeights(next);
  }
  return normalizeWeights(next);
}

// src/tools/forget.ts
function registerForgetTool(options) {
  const { api, client, banks, logger, getTurnContext } = options;
  api.registerTool(
    {
      name: "hippocampus_forget",
      label: "Hippocampus Forget",
      description: "Forget a memory by id or search query.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string" },
          query: { type: "string" },
          scope: { type: "string", enum: ["shared", "private", "all"] }
        }
      },
      async execute(_toolCallId, params) {
        const turn = getTurnContext();
        const resolved = await banks.resolveForTurn(turn);
        const scope = params.scope ?? "all";
        const bankIds = scope === "shared" ? [resolved.sharedBankId] : scope === "private" ? [resolved.privateBankId] : [resolved.privateBankId, resolved.sharedBankId];
        if (params.memoryId) {
          for (const bankId of bankIds) {
            try {
              await client.deleteMemory(bankId, params.memoryId);
              return {
                content: [{ type: "text", text: "Memory forgotten." }]
              };
            } catch (error) {
              logger.warn(`forget by id failed bank_id=${bankId}: ${String(error)}`);
            }
          }
          return {
            content: [{ type: "text", text: "Unable to forget memory id in selected scope." }]
          };
        }
        const query = String(params.query ?? "").trim();
        if (!query) {
          return {
            content: [{ type: "text", text: "Provide memoryId or query to forget." }]
          };
        }
        for (const bankId of bankIds) {
          try {
            const recall = await client.recall(bankId, {
              query,
              k_results: 1,
              k_per_strategy: 6,
              temporal_weight: 0.3,
              entity_weight: 0.3,
              meaning_weight: 0.2,
              path_weight: 0.2,
              rerank: true,
              query_intent_mode: "auto",
              temporal_supersession_enabled: true,
              consistency_mode: "strong"
            });
            const first = recall.memories?.[0];
            if (!first?.memory?.id) continue;
            await client.deleteMemory(first.memory.bank_id, first.memory.id);
            return {
              content: [
                {
                  type: "text",
                  text: `Forgot: "${truncate(first.memory.content, 120)}"`
                }
              ]
            };
          } catch (error) {
            logger.warn(`forget by query failed bank_id=${bankId}: ${String(error)}`);
          }
        }
        return {
          content: [{ type: "text", text: "No matching memory found to forget." }]
        };
      }
    },
    { name: "hippocampus_forget" }
  );
}
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

// src/tools/profile.ts
function registerProfileTool(options) {
  const { api, client, banks, logger, getTurnContext } = options;
  api.registerTool(
    {
      name: "hippocampus_profile",
      label: "Hippocampus Profile",
      description: "Show inferred static and dynamic memory profile from recalled memories.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string", enum: ["shared", "private", "all"] }
        }
      },
      async execute(_toolCallId, params) {
        const turn = getTurnContext();
        const resolved = await banks.resolveForTurn(turn);
        const query = params.query?.trim() || "user preferences project decisions recent context";
        const scope = params.scope ?? "all";
        const bankIds = scope === "shared" ? [resolved.sharedBankId] : scope === "private" ? [resolved.privateBankId] : [resolved.privateBankId, resolved.sharedBankId];
        const all = [];
        for (const bankId of bankIds) {
          try {
            const response = await client.recall(bankId, {
              query,
              k_results: 12,
              k_per_strategy: 15,
              temporal_weight: 0.3,
              entity_weight: 0.3,
              meaning_weight: 0.2,
              path_weight: 0.2,
              rerank: true,
              query_intent_mode: "auto",
              temporal_supersession_enabled: true,
              consistency_mode: "strong"
            });
            for (const item of response.memories ?? []) {
              all.push({
                content: item.memory.content,
                score: item.score ?? 0
              });
            }
          } catch (error) {
            logger.warn(`profile recall failed bank_id=${bankId}: ${String(error)}`);
          }
        }
        const deduped = dedupe(all);
        const staticFacts = [];
        const dynamicFacts = [];
        for (const row of deduped) {
          const category = inferMemoryCategory(row.content);
          if (category === "preference" || category === "project_decision") {
            staticFacts.push(row.content);
          } else {
            dynamicFacts.push(row.content);
          }
        }
        if (staticFacts.length === 0 && dynamicFacts.length === 0) {
          return {
            content: [{ type: "text", text: "No profile information available yet." }]
          };
        }
        const sections = [];
        if (staticFacts.length > 0) {
          sections.push(
            "## User Profile (Persistent)\n" + staticFacts.slice(0, 10).map((s) => `- ${s}`).join("\n")
          );
        }
        if (dynamicFacts.length > 0) {
          sections.push(
            "## Recent Context\n" + dynamicFacts.slice(0, 10).map((s) => `- ${s}`).join("\n")
          );
        }
        return {
          content: [{ type: "text", text: sections.join("\n\n") }],
          details: {
            staticCount: staticFacts.length,
            dynamicCount: dynamicFacts.length
          }
        };
      }
    },
    { name: "hippocampus_profile" }
  );
}
function dedupe(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = item.content.trim();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) {
      map.set(key, item);
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

// src/tools/search.ts
function registerSearchTool(options) {
  const { api, client, banks, logger, getTurnContext } = options;
  api.registerTool(
    {
      name: "hippocampus_search",
      label: "Hippocampus Search",
      description: "Search long-term memories in Hippocampus.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 50 },
          scope: { type: "string", enum: ["shared", "private", "all"] }
        },
        required: ["query"]
      },
      async execute(_toolCallId, params) {
        const query = String(params.query ?? "").trim();
        if (!query) {
          return { content: [{ type: "text", text: "Search query is required." }] };
        }
        const limit = Math.max(1, Math.min(50, Number(params.limit ?? 5)));
        const scope = params.scope ?? "all";
        const turn = getTurnContext();
        const resolved = await banks.resolveForTurn(turn);
        const scopes = scope === "all" ? ["private", "shared"] : [scope];
        const perScope = Math.max(limit, Math.ceil(limit * 2 / Math.max(1, scopes.length)));
        const results = [];
        for (const bankScope of scopes) {
          const bankId = bankScope === "shared" ? resolved.sharedBankId : resolved.privateBankId;
          try {
            const response = await client.recall(bankId, {
              query,
              k_results: perScope,
              k_per_strategy: 15,
              temporal_weight: 0.3,
              entity_weight: 0.3,
              meaning_weight: 0.2,
              path_weight: 0.2,
              rerank: true,
              query_intent_mode: "auto",
              temporal_supersession_enabled: true,
              consistency_mode: "strong"
            });
            for (const item of response.memories ?? []) {
              results.push({
                id: item.memory.id,
                content: item.memory.content,
                score: item.score ?? 0,
                bankId: item.memory.bank_id
              });
            }
          } catch (error) {
            logger.warn(`search failed for scope=${bankScope} bank_id=${bankId}: ${String(error)}`);
          }
        }
        const deduped = dedupe2(results).slice(0, limit);
        if (deduped.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant memories found." }],
            details: { count: 0, memories: [] }
          };
        }
        const text = deduped.map((hit, idx) => `${idx + 1}. ${hit.content} (${Math.round(hit.score * 100)}%)`).join("\n");
        return {
          content: [{ type: "text", text: `Found ${deduped.length} memories:

${text}` }],
          details: {
            count: deduped.length,
            memories: deduped.map((hit) => ({
              id: hit.id,
              content: hit.content,
              similarity: hit.score,
              bankId: hit.bankId
            }))
          }
        };
      }
    },
    { name: "hippocampus_search" }
  );
}
function dedupe2(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const existing = map.get(item.id);
    if (!existing || item.score > existing.score) {
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

// src/tools/store.ts
function registerStoreTool(options) {
  const { api, client, banks, logger, getTurnContext } = options;
  api.registerTool(
    {
      name: "hippocampus_store",
      label: "Hippocampus Store",
      description: "Store important information in Hippocampus memory.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Information to remember" },
          category: {
            type: "string",
            enum: ["preference", "workflow", "project_decision", "fact"]
          },
          scope: {
            type: "string",
            enum: ["shared", "private", "auto"]
          }
        },
        required: ["text"]
      },
      async execute(_toolCallId, params) {
        const text = String(params.text ?? "").trim();
        if (!text) {
          return { content: [{ type: "text", text: "Nothing to store." }] };
        }
        const turn = getTurnContext();
        const category = params.category ?? inferMemoryCategory(text);
        const baseTargets = categoryTargets(category);
        const targets = params.scope && params.scope !== "auto" ? [params.scope] : baseTargets;
        let resolved = await banks.resolveForTurn(turn);
        const writes = targets.map(async (scope) => {
          const bankId = scope === "shared" ? resolved.sharedBankId : resolved.privateBankId;
          const memoryType = categoryToMemoryType(category);
          const confidence = confidenceForMemoryType(memoryType);
          const idempotencyKey = buildDeterministicIdempotencyKey(
            turn,
            text,
            `tool:${scope}`
          );
          try {
            await client.remember(bankId, {
              content: text,
              memory_type: memoryType,
              confidence,
              timestamp: turn.timestampIso,
              idempotency_key: idempotencyKey,
              metadata: {
                schema_version: "v1",
                project_id: turn.projectId,
                agent_id: turn.agentId,
                session_id: turn.sessionId,
                turn_id: turn.turnId,
                memory_category: category,
                target_scope: scope,
                source: "openclaw.tool.store"
              }
            });
          } catch (error) {
            logger.warn(`store failed for scope=${scope}: ${String(error)}`);
            if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
              throw error;
            }
            banks.invalidateByBankId(bankId);
            const refreshed = await banks.resolveForTurn(turn);
            resolved = refreshed;
            const retryBankId = scope === "shared" ? refreshed.sharedBankId : refreshed.privateBankId;
            await client.remember(retryBankId, {
              content: text,
              memory_type: memoryType,
              confidence,
              timestamp: turn.timestampIso,
              idempotency_key: idempotencyKey,
              metadata: {
                schema_version: "v1",
                project_id: turn.projectId,
                agent_id: turn.agentId,
                session_id: turn.sessionId,
                turn_id: turn.turnId,
                memory_category: category,
                target_scope: scope,
                source: "openclaw.tool.store"
              }
            });
          }
        });
        await Promise.all(writes);
        const preview = text.length > 100 ? `${text.slice(0, 100)}\u2026` : text;
        return {
          content: [{ type: "text", text: `Stored memory: "${preview}"` }],
          details: { category, targets }
        };
      }
    },
    { name: "hippocampus_store" }
  );
}

// src/index.ts
var index_default = {
  id: "openclaw-hipocampus",
  name: "Hippocampus",
  description: "OpenClaw memory plugin powered by Hippocampus",
  kind: "memory",
  configSchema: hippocampusConfigSchema,
  register(api) {
    const cfg = parseConfig(api.pluginConfig);
    const logger = createLogger(api.logger, cfg.debug);
    if (!cfg.apiKey) {
      logger.info(
        "hippocampus: missing api key, set HIPPOCAMPUS_OPENCLAW_API_KEY or plugin config.apiKey"
      );
      return;
    }
    const client = new HippocampusClient({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      recallTimeoutMs: cfg.recallTimeoutMs,
      rememberTimeoutMs: cfg.rememberTimeoutMs,
      requestRetryAttempts: cfg.requestRetryAttempts,
      logger
    });
    const banks = new BankResolver(client, cfg, logger);
    const weightProfiles = new WeightProfiles();
    let latestTurn;
    const setTurnContext = (turn) => {
      latestTurn = turn;
    };
    const getTurnContext = () => {
      if (latestTurn) return latestTurn;
      return inferTurnContext({}, {});
    };
    if (cfg.autoRecall) {
      api.on(
        "before_agent_start",
        buildRecallHandler({
          client,
          cfg,
          banks,
          logger,
          weightProfiles,
          onTurnContext: setTurnContext
        })
      );
    }
    if (cfg.autoCapture) {
      api.on(
        "agent_end",
        buildCaptureHandler({
          client,
          cfg,
          banks,
          logger,
          weightProfiles,
          onTurnContext: setTurnContext
        })
      );
    }
    registerStoreTool({ api, client, banks, logger, getTurnContext });
    registerSearchTool({ api, client, banks, logger, getTurnContext });
    registerForgetTool({ api, client, banks, logger, getTurnContext });
    registerProfileTool({ api, client, banks, logger, getTurnContext });
    api.registerService({
      id: "openclaw-hipocampus",
      start: () => logger.info("hippocampus: connected"),
      stop: () => logger.info("hippocampus: stopped")
    });
  }
};
export {
  index_default as default
};
