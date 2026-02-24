import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

import type { BankResolver } from '../banks.js'
import type { HippocampusClient } from '../client.js'
import type { Logger } from '../logger.js'
import type { TurnContext } from '../types.js'

type SearchParams = {
  query: string
  limit?: number
  scope?: 'shared' | 'private' | 'all'
}

type SearchHit = {
  id: string
  content: string
  score: number
  bankId: string
}

export function registerSearchTool(options: {
  api: OpenClawPluginApi
  client: HippocampusClient
  banks: BankResolver
  logger: Logger
  getTurnContext: () => TurnContext
}) {
  const { api, client, banks, logger, getTurnContext } = options

  api.registerTool(
    {
      name: 'hippocampus_search',
      label: 'Hippocampus Search',
      description: 'Search long-term memories in Hippocampus.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 50 },
          scope: { type: 'string', enum: ['shared', 'private', 'all'] },
        },
        required: ['query'],
      },
      async execute(_toolCallId: string, params: SearchParams) {
        const query = String(params.query ?? '').trim()
        if (!query) {
          return { content: [{ type: 'text', text: 'Search query is required.' }] }
        }

        const limit = Math.max(1, Math.min(50, Number(params.limit ?? 5)))
        const scope = params.scope ?? 'all'

        const turn = getTurnContext()
        const resolved = await banks.resolveForTurn(turn)

        const scopes: Array<'shared' | 'private'> =
          scope === 'all' ? ['private', 'shared'] : [scope]

        const perScope = Math.max(limit, Math.ceil((limit * 2) / Math.max(1, scopes.length)))

        const results: SearchHit[] = []
        for (const bankScope of scopes) {
          const bankId = bankScope === 'shared' ? resolved.sharedBankId : resolved.privateBankId
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
              query_intent_mode: 'auto',
              temporal_supersession_enabled: true,
              consistency_mode: 'strong',
            })

            for (const item of response.memories ?? []) {
              results.push({
                id: item.memory.id,
                content: item.memory.content,
                score: item.score ?? 0,
                bankId: item.memory.bank_id,
              })
            }
          } catch (error) {
            logger.warn(`search failed for scope=${bankScope} bank_id=${bankId}: ${String(error)}`)
          }
        }

        const deduped = dedupe(results).slice(0, limit)
        if (deduped.length === 0) {
          return {
            content: [{ type: 'text', text: 'No relevant memories found.' }],
            details: { count: 0, memories: [] },
          }
        }

        const text = deduped
          .map((hit, idx) => `${idx + 1}. ${hit.content} (${Math.round(hit.score * 100)}%)`)
          .join('\n')

        return {
          content: [{ type: 'text', text: `Found ${deduped.length} memories:\n\n${text}` }],
          details: {
            count: deduped.length,
            memories: deduped.map((hit) => ({
              id: hit.id,
              content: hit.content,
              similarity: hit.score,
              bankId: hit.bankId,
            })),
          },
        }
      },
    },
    { name: 'hippocampus_search' },
  )
}

function dedupe(items: SearchHit[]): SearchHit[] {
  const map = new Map<string, SearchHit>()
  for (const item of items) {
    const existing = map.get(item.id)
    if (!existing || item.score > existing.score) {
      map.set(item.id, item)
    }
  }

  return [...map.values()].sort((a, b) => b.score - a.score)
}
