import { createHash } from 'node:crypto'

import type { TurnContext } from './types.js'

export function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function buildDeterministicIdempotencyKey(
  turn: TurnContext,
  content: string,
  suffix: string,
): string {
  const hash = hashText(`${content}:${suffix}`).slice(0, 12)
  return `oc:${turn.projectId}:${turn.agentId}:${turn.sessionId}:${turn.turnId}:${hash}`
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  // Support both {var} and {{var}} forms to match existing template defaults.
  return template.replace(/\{\{?([a-zA-Z0-9_]+)\}?\}/g, (_m, key: string) => {
    return vars[key] ?? ''
  })
}

export function toIsoNow(): string {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeWeights<T extends Record<string, number>>(input: T): T {
  const sum = Object.values(input).reduce((acc, v) => acc + Math.max(0, v), 0)
  if (sum <= 0) {
    const keys = Object.keys(input)
    const even = 1 / keys.length
    const out = { ...input }
    for (const k of keys) {
      out[k as keyof T] = even as T[keyof T]
    }
    return out
  }

  const out = { ...input }
  for (const [k, v] of Object.entries(input)) {
    out[k as keyof T] = (Math.max(0, v) / sum) as T[keyof T]
  }
  return out
}

export function jitterSleepMs(baseMs: number, attempt: number): Promise<void> {
  const cap = Math.min(8_000, baseMs * 2 ** attempt)
  const jitter = cap * (0.2 + Math.random() * 0.3)
  return new Promise((resolve) => setTimeout(resolve, Math.round(cap + jitter)))
}
