import type { RecalledMemory, RouteDecision, WeightProfile } from '../types.js'
import { clamp, normalizeWeights } from '../utils.js'

type Intent = 'temporal' | 'factual' | 'procedural' | 'balanced'

const INTENT_PRESETS: Record<Intent, WeightProfile> = {
  temporal: { temporal: 0.5, entity: 0.2, meaning: 0.2, path: 0.1 },
  factual: { temporal: 0.25, entity: 0.35, meaning: 0.3, path: 0.1 },
  procedural: { temporal: 0.15, entity: 0.2, meaning: 0.45, path: 0.2 },
  balanced: { temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 },
}

export function decideRouteAndSelect(options: {
  query: string
  candidates: RecalledMemory[]
  maxResults: number
  profile: WeightProfile
  confidenceThreshold: number
  readjustEnabled: boolean
}): RouteDecision {
  const ranked = [...options.candidates].sort((a, b) => b.score - a.score)
  if (ranked.length === 0) {
    return {
      route: 'use',
      confidence: 0,
      selected: [],
      reason: 'no_candidates',
    }
  }

  const top = ranked[0]?.score ?? 0
  const fifth = ranked[Math.min(4, ranked.length - 1)]?.score ?? 0
  const spread = clamp(top - fifth, 0, 1)
  const conflictMap = detectConflicts(ranked)
  const hasStrongConflict = conflictMap.size > 0

  const confidence = clamp(0.65 * top + 0.35 * spread, 0, 1)

  const shouldReadjust =
    options.readjustEnabled &&
    (confidence < options.confidenceThreshold || hasStrongConflict)

  if (!shouldReadjust) {
    return {
      route: 'use',
      confidence,
      selected: ranked.slice(0, options.maxResults),
      reason: hasStrongConflict ? 'conflict_but_high_confidence' : 'high_confidence',
    }
  }

  const intent = detectIntent(options.query)
  const preset = INTENT_PRESETS[intent]
  const weights = normalizeWeights({
    temporal: (preset.temporal + options.profile.temporal) / 2,
    entity: (preset.entity + options.profile.entity) / 2,
    meaning: (preset.meaning + options.profile.meaning) / 2,
    path: (preset.path + options.profile.path) / 2,
  })

  const rescored = ranked
    .map((candidate) => {
      const conflictPenalty = conflictMap.has(candidate.id) ? 1 : 0
      const recencyBonus = computeRecencyBonus(candidate.timestamp)
      const adjusted =
        weights.temporal * candidate.temporalScore +
        weights.entity * candidate.entityScore +
        weights.meaning * candidate.meaningScore +
        weights.path * candidate.pathScore +
        0.15 * candidate.valueMatchScore -
        0.4 * conflictPenalty +
        recencyBonus

      return {
        candidate,
        adjusted,
      }
    })
    .sort((a, b) => b.adjusted - a.adjusted)
    .map((item) => item.candidate)

  return {
    route: 'readjust',
    confidence,
    selected: rescored.slice(0, options.maxResults),
    reason: hasStrongConflict ? 'conflict' : `low_confidence_${intent}`,
  }
}

function detectIntent(query: string): Intent {
  const q = query.toLowerCase()

  if (/(when|latest|recent|today|yesterday|before|after|timeline|changed)/i.test(q)) {
    return 'temporal'
  }
  if (/(how|steps|implement|build|run|deploy|procedure)/i.test(q)) {
    return 'procedural'
  }
  if (/(who|what|which|name|owner|person|entity|preference)/i.test(q)) {
    return 'factual'
  }
  return 'balanced'
}

function detectConflicts(candidates: RecalledMemory[]): Set<string> {
  const bySubject = new Map<string, Map<string, string[]>>()

  for (const candidate of candidates.slice(0, 12)) {
    const claim = extractClaim(candidate.content)
    if (!claim) continue

    const subjectMap = bySubject.get(claim.subject) ?? new Map<string, string[]>()
    const ids = subjectMap.get(claim.predicate) ?? []
    ids.push(candidate.id)
    subjectMap.set(claim.predicate, ids)
    bySubject.set(claim.subject, subjectMap)
  }

  const conflictIds = new Set<string>()
  for (const predicates of bySubject.values()) {
    if (predicates.size <= 1) continue
    for (const ids of predicates.values()) {
      for (const id of ids) {
        conflictIds.add(id)
      }
    }
  }

  return conflictIds
}

function extractClaim(content: string): { subject: string; predicate: string } | null {
  const match = content.match(/\b([A-Z][a-zA-Z0-9_'-]{1,40})\b\s+(?:is|are|was|were)\s+([^.,;]+)/)
  if (!match) return null
  return {
    subject: match[1].toLowerCase(),
    predicate: match[2].trim().toLowerCase(),
  }
}

function computeRecencyBonus(timestamp: string): number {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 0

  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
  return clamp(1 - ageDays / 365, 0, 1) * 0.05
}
