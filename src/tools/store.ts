import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

import type { BankResolver } from '../banks.js'
import type { HippocampusClient } from '../client.js'
import type { Logger } from '../logger.js'
import {
  categoryTargets,
  categoryToMemoryType,
  confidenceForMemoryType,
  inferMemoryCategory,
} from '../memory.js'
import { HippocampusHttpError } from '../types.js'
import type { TurnContext } from '../types.js'
import { buildDeterministicIdempotencyKey } from '../utils.js'

type StoreParams = {
  text: string
  category?: 'preference' | 'workflow' | 'project_decision' | 'fact'
  scope?: 'shared' | 'private' | 'auto'
}

export function registerStoreTool(options: {
  api: OpenClawPluginApi
  client: HippocampusClient
  banks: BankResolver
  logger: Logger
  getTurnContext: () => TurnContext
}) {
  const { api, client, banks, logger, getTurnContext } = options

  api.registerTool(
    {
      name: 'hippocampus_store',
      label: 'Hippocampus Store',
      description: 'Store important information in Hippocampus memory.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Information to remember' },
          category: {
            type: 'string',
            enum: ['preference', 'workflow', 'project_decision', 'fact'],
          },
          scope: {
            type: 'string',
            enum: ['shared', 'private', 'auto'],
          },
        },
        required: ['text'],
      },
      async execute(_toolCallId: string, params: StoreParams) {
        const text = String(params.text ?? '').trim()
        if (!text) {
          return { content: [{ type: 'text', text: 'Nothing to store.' }] }
        }

        const turn = getTurnContext()
        const category = params.category ?? inferMemoryCategory(text)
        const baseTargets = categoryTargets(category)
        const targets =
          params.scope && params.scope !== 'auto' ? [params.scope] : baseTargets

        let resolved = await banks.resolveForTurn(turn)
        const writes = targets.map(async (scope) => {
          const bankId = scope === 'shared' ? resolved.sharedBankId : resolved.privateBankId
          const memoryType = categoryToMemoryType(category)
          const confidence = confidenceForMemoryType(memoryType)
          const idempotencyKey = buildDeterministicIdempotencyKey(
            turn,
            text,
            `tool:${scope}`,
          )

          try {
            await client.remember(bankId, {
              content: text,
              memory_type: memoryType,
              confidence,
              timestamp: turn.timestampIso,
              idempotency_key: idempotencyKey,
              metadata: {
                schema_version: 'v1',
                project_id: turn.projectId,
                agent_id: turn.agentId,
                session_id: turn.sessionId,
                turn_id: turn.turnId,
                memory_category: category,
                target_scope: scope,
                source: 'openclaw.tool.store',
              },
            })
          } catch (error) {
            logger.warn(`store failed for scope=${scope}: ${String(error)}`)
            if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
              throw error
            }
            banks.invalidateByBankId(bankId)
            const refreshed = await banks.resolveForTurn(turn)
            resolved = refreshed
            const retryBankId = scope === 'shared' ? refreshed.sharedBankId : refreshed.privateBankId
            await client.remember(retryBankId, {
              content: text,
              memory_type: memoryType,
              confidence,
              timestamp: turn.timestampIso,
              idempotency_key: idempotencyKey,
              metadata: {
                schema_version: 'v1',
                project_id: turn.projectId,
                agent_id: turn.agentId,
                session_id: turn.sessionId,
                turn_id: turn.turnId,
                memory_category: category,
                target_scope: scope,
                source: 'openclaw.tool.store',
              },
            })
          }
        })

        await Promise.all(writes)

        const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text
        return {
          content: [{ type: 'text', text: `Stored memory: "${preview}"` }],
          details: { category, targets },
        }
      },
    },
    { name: 'hippocampus_store' },
  )
}
