import type { HippocampusPluginConfig } from './types.js'

const ALLOWED_KEYS = new Set([
  'apiKey',
  'baseUrl',
  'autoRecall',
  'autoCapture',
  'maxRecallResults',
  'profileFrequency',
  'routingMode',
  'sharedBankNameTemplate',
  'agentBankNameTemplate',
  'readjustEnabled',
  'readjustConfidenceThreshold',
  'debug',
  'recallTimeoutMs',
  'rememberTimeoutMs',
  'requestRetryAttempts',
])

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function parseBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_m, envVar: string) => {
    const envValue = process.env[envVar]
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`)
    }
    return envValue
  })
}

export function parseConfig(raw: unknown): HippocampusPluginConfig {
  const cfg = asObject(raw)

  const unknown = Object.keys(cfg).filter((k) => !ALLOWED_KEYS.has(k))
  if (unknown.length > 0) {
    throw new Error(`hippocampus config has unknown keys: ${unknown.join(', ')}`)
  }

  const apiKeyRaw =
    typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0
      ? cfg.apiKey
      : process.env.HIPPOCAMPUS_OPENCLAW_API_KEY

  const apiKey = apiKeyRaw ? resolveEnvVars(apiKeyRaw) : undefined

  return {
    apiKey,
    baseUrl:
      (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim().length > 0
        ? cfg.baseUrl
        : 'http://127.0.0.1:8080')
        .replace(/\/$/, ''),
    autoRecall: parseBool(cfg.autoRecall, true),
    autoCapture: parseBool(cfg.autoCapture, true),
    maxRecallResults: Math.max(1, Math.min(50, parseNum(cfg.maxRecallResults, 10))),
    profileFrequency: Math.max(1, parseNum(cfg.profileFrequency, 50)),
    routingMode: 'project_agent_hybrid',
    sharedBankNameTemplate:
      typeof cfg.sharedBankNameTemplate === 'string'
        ? cfg.sharedBankNameTemplate
        : 'oc::{project_id}::shared',
    agentBankNameTemplate:
      typeof cfg.agentBankNameTemplate === 'string'
        ? cfg.agentBankNameTemplate
        : 'oc::{project_id}::agent::{agent_id}',
    readjustEnabled: parseBool(cfg.readjustEnabled, true),
    readjustConfidenceThreshold: Math.max(
      0,
      Math.min(1, parseNum(cfg.readjustConfidenceThreshold, 0.62)),
    ),
    debug: parseBool(cfg.debug, false),
    recallTimeoutMs: Math.max(1000, parseNum(cfg.recallTimeoutMs, 10_000)),
    rememberTimeoutMs: Math.max(1000, parseNum(cfg.rememberTimeoutMs, 10_000)),
    requestRetryAttempts: Math.max(0, Math.min(5, parseNum(cfg.requestRetryAttempts, 2))),
  }
}

export const hippocampusConfigSchema = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      apiKey: { type: 'string' },
      baseUrl: { type: 'string' },
      autoRecall: { type: 'boolean' },
      autoCapture: { type: 'boolean' },
      maxRecallResults: { type: 'number', minimum: 1, maximum: 50 },
      profileFrequency: { type: 'number', minimum: 1 },
      routingMode: { type: 'string', enum: ['project_agent_hybrid'] },
      sharedBankNameTemplate: { type: 'string' },
      agentBankNameTemplate: { type: 'string' },
      readjustEnabled: { type: 'boolean' },
      readjustConfidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
      debug: { type: 'boolean' },
      recallTimeoutMs: { type: 'number', minimum: 1000 },
      rememberTimeoutMs: { type: 'number', minimum: 1000 },
      requestRetryAttempts: { type: 'number', minimum: 0, maximum: 5 },
    },
    required: [],
  },
  parse: parseConfig,
}
