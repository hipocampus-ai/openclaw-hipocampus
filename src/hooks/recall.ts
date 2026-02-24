import type { HippocampusClient } from '../client.js'
import type { BankResolver } from '../banks.js'
import type { Logger } from '../logger.js'
import type {
  HippocampusPluginConfig,
  RecallRequest,
  RecalledMemory,
  ResolvedBanks,
  TurnContext,
} from '../types.js'
import { HippocampusHttpError } from '../types.js'
import { countUserTurns } from '../message.js'
import { inferMemoryCategory, toRelativeTime } from '../memory.js'
import { decideRouteAndSelect } from '../optimizer/single_pass.js'
import { inferTurnContext } from '../turn_context.js'
import type { WeightProfiles } from '../state/weight_profiles.js'

export function buildRecallHandler(options: {
  client: HippocampusClient
  cfg: HippocampusPluginConfig
  banks: BankResolver
  logger: Logger
  weightProfiles: WeightProfiles
  onTurnContext?: (turn: TurnContext) => void
}) {
  const { client, cfg, banks, logger, weightProfiles, onTurnContext } = options

  return async (event: Record<string, unknown>, ctx?: Record<string, unknown>) => {
    const prompt = typeof event.prompt === 'string' ? event.prompt.trim() : ''
    if (!prompt) return

    const turn = inferTurnContext(event, ctx)
    onTurnContext?.(turn)

    let resolved = await banks.resolveForTurn(turn)

    const weights = weightProfiles.get(turn)
    const basePayload: RecallRequest = {
      query: prompt,
      k_results: Math.max(cfg.maxRecallResults * 2, cfg.maxRecallResults),
      k_per_strategy: 15,
      temporal_weight: weights.temporal,
      entity_weight: weights.entity,
      meaning_weight: weights.meaning,
      path_weight: weights.path,
      rerank: true,
      query_intent_mode: 'auto',
      temporal_supersession_enabled: true,
      consistency_mode: 'strong',
    }

    const [privateResults, sharedResults] = await Promise.all([
      recallForScope({
        scope: 'private',
        bankId: resolved.privateBankId,
        payload: basePayload,
        turn,
        resolved,
        client,
        banks,
        logger,
      }),
      recallForScope({
        scope: 'shared',
        bankId: resolved.sharedBankId,
        payload: basePayload,
        turn,
        resolved,
        client,
        banks,
        logger,
      }),
    ])

    const merged = dedupeMemories([...privateResults, ...sharedResults])

    const decision = decideRouteAndSelect({
      query: prompt,
      candidates: merged,
      maxResults: cfg.maxRecallResults,
      profile: weights,
      confidenceThreshold: cfg.readjustConfidenceThreshold,
      readjustEnabled: cfg.readjustEnabled,
    })

    logger.debug(
      `recall route=${decision.route} confidence=${decision.confidence.toFixed(3)} reason=${decision.reason}`,
    )

    if (decision.selected.length === 0) {
      return
    }

    const messages = Array.isArray(event.messages) ? event.messages : []
    const turns = countUserTurns(messages)
    const includeProfile = turns <= 1 || turns % cfg.profileFrequency === 0

    const context = formatContext(decision.selected, includeProfile)
    if (!context) return

    return { prependContext: context }
  }
}

async function recallForScope(options: {
  scope: 'shared' | 'private'
  bankId: string
  payload: RecallRequest
  turn: TurnContext
  resolved: ResolvedBanks
  client: HippocampusClient
  banks: BankResolver
  logger: Logger
}): Promise<RecalledMemory[]> {
  const { scope, payload, turn, client, banks, logger } = options
  let bankId = options.bankId

  const run = async (targetBankId: string): Promise<RecalledMemory[]> => {
    const response = await client.recall(targetBankId, payload)
    return (response.memories ?? []).map((item) => ({
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
      metadata: item.memory.provenance ?? undefined,
    }))
  }

  try {
    return await run(bankId)
  } catch (error) {
    if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
      logger.warn(`recall failed for ${scope} bank_id=${bankId}: ${String(error)}`)
      return []
    }

    logger.warn(`bank not found during recall for ${scope}; invalidating cache and retrying once`)
    banks.invalidateByBankId(bankId)

    const refreshed = await banks.resolveForTurn(turn)
    bankId = scope === 'shared' ? refreshed.sharedBankId : refreshed.privateBankId

    try {
      return await run(bankId)
    } catch (retryError) {
      logger.warn(
        `recall retry failed for ${scope} bank_id=${bankId}: ${String(retryError)}`,
      )
      return []
    }
  }
}

function dedupeMemories(memories: RecalledMemory[]): RecalledMemory[] {
  const best = new Map<string, RecalledMemory>()

  for (const memory of memories) {
    const existing = best.get(memory.id)
    if (!existing || memory.score > existing.score) {
      best.set(memory.id, memory)
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score)
}

function formatContext(memories: RecalledMemory[], includeProfile: boolean): string | null {
  const staticFacts: string[] = []
  const dynamicFacts: string[] = []

  for (const memory of memories) {
    const category = inferMemoryCategory(memory.content)
    if (category === 'preference' || category === 'project_decision') {
      staticFacts.push(memory.content)
    } else {
      dynamicFacts.push(memory.content)
    }
  }

  const sections: string[] = []
  if (includeProfile && staticFacts.length > 0) {
    sections.push(
      '## Persistent Preferences/Decisions\n' +
        staticFacts.slice(0, 8).map((s) => `- ${s}`).join('\n'),
    )
  }

  if (includeProfile && dynamicFacts.length > 0) {
    sections.push(
      '## Recent Context\n' + dynamicFacts.slice(0, 8).map((s) => `- ${s}`).join('\n'),
    )
  }

  const relevant = memories
    .slice(0, 12)
    .map((m) => {
      const time = toRelativeTime(m.timestamp)
      const score = Math.round(m.score * 100)
      return `- [${time}] ${m.content} (${score}%)`
    })

  if (relevant.length > 0) {
    sections.push('## Relevant Memories\n' + relevant.join('\n'))
  }

  if (sections.length === 0) {
    return null
  }

  return [
    '<hippocampus-context>',
    'The following long-term memory context is for grounding. Use it only when relevant to the user request.',
    '',
    ...sections,
    '',
    'Do not proactively mention memory unless it is directly useful for the current request.',
    '</hippocampus-context>',
  ].join('\n')
}
