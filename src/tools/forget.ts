import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

import type { BankResolver } from '../banks.js'
import type { HippocampusClient } from '../client.js'
import type { Logger } from '../logger.js'
import type { TurnContext } from '../types.js'

type ForgetParams = {
  memoryId?: string
  query?: string
  scope?: 'shared' | 'private' | 'all'
}

export function registerForgetTool(options: {
  api: OpenClawPluginApi
  client: HippocampusClient
  banks: BankResolver
  logger: Logger
  getTurnContext: () => TurnContext
}) {
  const { api, client, banks, logger, getTurnContext } = options

  api.registerTool(
    {
      name: 'hippocampus_forget',
      label: 'Hippocampus Forget',
      description: 'Forget a memory by id or search query.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          query: { type: 'string' },
          scope: { type: 'string', enum: ['shared', 'private', 'all'] },
        },
      },
      async execute(_toolCallId: string, params: ForgetParams) {
        const turn = getTurnContext()
        const resolved = await banks.resolveForTurn(turn)
        const scope = params.scope ?? 'all'
        const bankIds =
          scope === 'shared'
            ? [resolved.sharedBankId]
            : scope === 'private'
              ? [resolved.privateBankId]
              : [resolved.privateBankId, resolved.sharedBankId]

        if (params.memoryId) {
          for (const bankId of bankIds) {
            try {
              await client.deleteMemory(bankId, params.memoryId)
              return {
                content: [{ type: 'text', text: 'Memory forgotten.' }],
              }
            } catch (error) {
              logger.warn(`forget by id failed bank_id=${bankId}: ${String(error)}`)
            }
          }

          return {
            content: [{ type: 'text', text: 'Unable to forget memory id in selected scope.' }],
          }
        }

        const query = String(params.query ?? '').trim()
        if (!query) {
          return {
            content: [{ type: 'text', text: 'Provide memoryId or query to forget.' }],
          }
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
              query_intent_mode: 'auto',
              temporal_supersession_enabled: true,
              consistency_mode: 'strong',
            })
            const first = recall.memories?.[0]
            if (!first?.memory?.id) continue

            await client.deleteMemory(first.memory.bank_id, first.memory.id)
            return {
              content: [
                {
                  type: 'text',
                  text: `Forgot: "${truncate(first.memory.content, 120)}"`,
                },
              ],
            }
          } catch (error) {
            logger.warn(`forget by query failed bank_id=${bankId}: ${String(error)}`)
          }
        }

        return {
          content: [{ type: 'text', text: 'No matching memory found to forget.' }],
        }
      },
    },
    { name: 'hippocampus_forget' },
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
