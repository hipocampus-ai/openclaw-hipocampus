import type { TurnContext, WeightProfile } from '../types.js'
import { normalizeWeights } from '../utils.js'

const DEFAULT_PROFILE: WeightProfile = {
  temporal: 0.3,
  entity: 0.3,
  meaning: 0.2,
  path: 0.2,
}

type CorrectionSignal = 'temporal' | 'entity' | 'procedural' | 'generic' | null

export class WeightProfiles {
  private readonly profiles = new Map<string, WeightProfile>()

  get(turn: TurnContext): WeightProfile {
    const key = this.key(turn)
    return this.profiles.get(key) ?? { ...DEFAULT_PROFILE }
  }

  ingestCorrectionSignal(turn: TurnContext, userText: string): void {
    const signal = detectCorrectionSignal(userText)
    if (!signal) return

    queueMicrotask(() => {
      const current = this.get(turn)
      const next = applySignal(current, signal)
      this.profiles.set(this.key(turn), next)
    })
  }

  private key(turn: TurnContext): string {
    return `${turn.projectId}::${turn.agentId}`
  }
}

function detectCorrectionSignal(text: string): CorrectionSignal {
  const lower = text.toLowerCase()
  if (!/(wrong|incorrect|not right|i said|that's not|that is not)/i.test(lower)) {
    return null
  }

  if (/(latest|recent|outdated|now|no longer|changed|today|yesterday|when)/i.test(lower)) {
    return 'temporal'
  }

  if (/(who|name|person|team|owner|entity)/i.test(lower)) {
    return 'entity'
  }

  if (/(how|steps|implement|build|run|deploy|procedure)/i.test(lower)) {
    return 'procedural'
  }

  return 'generic'
}

function applySignal(profile: WeightProfile, signal: CorrectionSignal): WeightProfile {
  const delta = 0.05
  const next = { ...profile }

  switch (signal) {
    case 'temporal':
      next.temporal += delta
      next.meaning -= delta / 2
      next.path -= delta / 2
      break
    case 'entity':
      next.entity += delta
      next.meaning -= delta / 2
      next.path -= delta / 2
      break
    case 'procedural':
      next.path += delta
      next.meaning += delta / 2
      next.temporal -= delta / 2
      break
    case 'generic':
      next.meaning += delta
      next.entity += delta / 2
      next.temporal -= delta / 2
      break
    default:
      return normalizeWeights(next)
  }

  return normalizeWeights(next)
}
