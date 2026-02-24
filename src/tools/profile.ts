import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

import type { BankResolver } from '../banks.js'
import type { HippocampusClient } from '../client.js'
import { inferMemoryCategory } from '../memory.js'
import type { Logger } from '../logger.js'
import type { TurnContext } from '../types.js'

type ProfileParams = {
  query?: string
  scope?: 'shared' | 'private' | 'all'
}

type MemoryLine = {
  content: string
  score: number
}

export function registerProfileTool(options: {
  api: OpenClawPluginApi
  client: HippocampusClient
  banks: BankResolver
  logger: Logger
  getTurnContext: () => TurnContext
}) {
  const { api, client, banks, logger, getTurnContext } = options

  api.registerTool(
    {
      name: 'hippocampus_profile',
      label: 'Hippocampus Profile',
      description: 'Show inferred static and dynamic memory profile from recalled memories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: ['shared', 'private', 'all'] },
        },
      },
      async execute(_toolCallId: string, params: ProfileParams) {
        const turn = getTurnContext()
        const resolved = await banks.resolveForTurn(turn)
        const query = params.query?.trim() || 'user preferences project decisions recent context'
        const scope = params.scope ?? 'all'

        const bankIds =
          scope === 'shared'
            ? [resolved.sharedBankId]
            : scope === 'private'
              ? [resolved.privateBankId]
              : [resolved.privateBankId, resolved.sharedBankId]

        const all: MemoryLine[] = []
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
              query_intent_mode: 'auto',
              temporal_supersession_enabled: true,
              consistency_mode: 'strong',
            })

            for (const item of response.memories ?? []) {
              all.push({
                content: item.memory.content,
                score: item.score ?? 0,
              })
            }
          } catch (error) {
            logger.warn(`profile recall failed bank_id=${bankId}: ${String(error)}`)
          }
        }

        const deduped = dedupe(all)
        const staticFacts: string[] = []
        const dynamicFacts: string[] = []

        for (const row of deduped) {
          const category = inferMemoryCategory(row.content)
          if (category === 'preference' || category === 'project_decision') {
            staticFacts.push(row.content)
          } else {
            dynamicFacts.push(row.content)
          }
        }

        if (staticFacts.length === 0 && dynamicFacts.length === 0) {
          return {
            content: [{ type: 'text', text: 'No profile information available yet.' }],
          }
        }

        const sections: string[] = []
        if (staticFacts.length > 0) {
          sections.push(
            '## User Profile (Persistent)\n' +
              staticFacts.slice(0, 10).map((s) => `- ${s}`).join('\n'),
          )
        }

        if (dynamicFacts.length > 0) {
          sections.push(
            '## Recent Context\n' + dynamicFacts.slice(0, 10).map((s) => `- ${s}`).join('\n'),
          )
        }

        return {
          content: [{ type: 'text', text: sections.join('\n\n') }],
          details: {
            staticCount: staticFacts.length,
            dynamicCount: dynamicFacts.length,
          },
        }
      },
    },
    { name: 'hippocampus_profile' },
  )
}

function dedupe(items: MemoryLine[]): MemoryLine[] {
  const map = new Map<string, MemoryLine>()

  for (const item of items) {
    const key = item.content.trim()
    if (!key) continue
    const existing = map.get(key)
    if (!existing || item.score > existing.score) {
      map.set(key, item)
    }
  }

  return [...map.values()].sort((a, b) => b.score - a.score)
}
