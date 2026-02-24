import type { BankScope, MemoryCategory, MemoryType } from './types.js'

export const CONTEXT_TAG = 'hippocampus-context'

export function inferMemoryCategory(content: string): MemoryCategory {
  const lower = content.toLowerCase()

  if (
    /(\bproject decision\b|\bproject-level\b|\bshared rule\b|\bshared decision\b|\barchitecture\b|\btech stack\b|\bcanonical\b|\buse\b.+\binstead\b|\bavoid\b)/i.test(
      lower,
    )
  ) {
    return 'project_decision'
  }

  if (
    /(\bprivate\b|\bonly this agent\b|\bfor this agent\b|\bagent-only\b|\bpersonal\b)/i.test(
      lower,
    )
  ) {
    return 'preference'
  }

  if (
    /(\bi\s+(prefer|like|love|hate|want|need)\b|\bmy\s+preferred\b|\bpreference\b|\balways\b|\bnever\b)/i.test(
      lower,
    )
  ) {
    return 'preference'
  }

  if (
    /(\bworkflow\b|\brun\b|\blint\b|\bbuild\b|\bdeploy\b|\btest\b|\blocally\b|\bcommand\b|\btooling\b)/i.test(
      lower,
    )
  ) {
    return 'workflow'
  }

  return 'fact'
}

export function categoryToMemoryType(category: MemoryCategory): MemoryType {
  switch (category) {
    case 'preference':
      return 'opinion'
    case 'workflow':
      return 'experience'
    case 'project_decision':
      return 'world'
    case 'fact':
    default:
      return 'world'
  }
}

export function confidenceForMemoryType(
  memoryType: MemoryType,
): number | undefined {
  // Hippo API requires confidence for opinion memories.
  if (memoryType === 'opinion') return 0.82
  return undefined
}

export function categoryTargets(category: MemoryCategory): BankScope[] {
  switch (category) {
    case 'project_decision':
      return ['shared']
    case 'preference':
    case 'workflow':
    case 'fact':
    default:
      return ['private']
  }
}

export function stripInjectedContext(content: string): string {
  return content
    .replace(/<hippocampus-context>[\s\S]*?<\/hippocampus-context>\s*/g, '')
    .trim()
}

export function toRelativeTime(timestampIso: string): string {
  const date = new Date(timestampIso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const deltaMs = Date.now() - date.getTime()
  const mins = deltaMs / (1000 * 60)
  if (mins < 30) return 'just now'
  if (mins < 60) return `${Math.floor(mins)}m ago`
  const hours = mins / 60
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 7) return `${Math.floor(days)}d ago`

  return date.toISOString().slice(0, 10)
}

export function compactText(input: string, max = 140): string {
  const value = input.replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function isLikelyQuestion(input: string): boolean {
  const text = input.trim()
  if (!text) return false
  if (text.includes('?')) return true
  if (text.endsWith('?')) return true
  return /^(who|what|when|where|why|how|can|could|would|should|will|do|does|did|is|are|am)\b/i.test(
    text,
  )
}

function toSentence(input: string): string {
  const text = input.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')
  if (!text) return ''
  const first = text[0].toUpperCase()
  const rest = text.slice(1)
  return `${first}${rest}.`
}

function parsePreferenceFacts(fragment: string): string[] {
  const normalized = fragment.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')
  const match = normalized.match(
    /^i\s+(prefer|like|love|hate|dislike|want|need)\s+(.+)$/i,
  )
  if (!match) return []

  const verb = match[1].toLowerCase()
  const tail = match[2].trim()
  if (!tail) return []

  const parts = tail
    .split(/\s*(?:,| and )\s+/i)
    .map((p) => p.trim().replace(/[.;]+$/, ''))
    .filter((p) => p.length >= 2)

  if (parts.length === 0) return []

  return parts.map((part) => {
    switch (verb) {
      case 'prefer':
        return toSentence(`User prefers ${part}`)
      case 'like':
      case 'love':
        return toSentence(`User likes ${part}`)
      case 'hate':
      case 'dislike':
        return toSentence(`User dislikes ${part}`)
      case 'want':
      case 'need':
      default:
        return toSentence(`User wants ${part}`)
    }
  })
}

function cleanMemoryText(input: string): string {
  return input
    .replace(/\[\[reply_to_current\]\]/g, '')
    .replace(/\[role:[^\]]+\]/g, '')
    .replace(/\[[a-z_]+:end\]/gi, '')
    .replace(/\*\*/g, '')
    .replace(/^[\s*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractAtomicMemories(input: string): string[] {
  const raw = cleanMemoryText(input)
  if (!raw || isLikelyQuestion(raw)) {
    return []
  }

  const fragments = raw
    .split(/\n|[;]+/g)
    .map((f) => cleanMemoryText(f))
    .filter((f) => f.length >= 8)

  const out: string[] = []
  for (const fragment of fragments) {
    if (isLikelyQuestion(fragment)) continue

    const prefFacts = parsePreferenceFacts(fragment)
    if (prefFacts.length > 0) {
      out.push(...prefFacts)
      continue
    }

    const sentence = toSentence(fragment)
    if (sentence.length >= 10) {
      out.push(sentence)
    }
  }

  return [...new Set(out)].slice(0, 6)
}
