import type { HippocampusClient } from '../client.js'
import type { BankResolver } from '../banks.js'
import type { Logger } from '../logger.js'
import { latestUserText } from '../message.js'
import {
  extractAtomicMemories,
  categoryTargets,
  categoryToMemoryType,
  confidenceForMemoryType,
  stripInjectedContext,
  inferMemoryCategory,
} from '../memory.js'
import { inferTurnContext } from '../turn_context.js'
import type { HippocampusPluginConfig, TurnContext } from '../types.js'
import { HippocampusHttpError } from '../types.js'
import { buildDeterministicIdempotencyKey } from '../utils.js'
import type { WeightProfiles } from '../state/weight_profiles.js'

export function buildCaptureHandler(options: {
  client: HippocampusClient
  cfg: HippocampusPluginConfig
  banks: BankResolver
  logger: Logger
  weightProfiles: WeightProfiles
  onTurnContext?: (turn: TurnContext) => void
}) {
  const { client, cfg, banks, logger, weightProfiles, onTurnContext } = options

  return async (event: Record<string, unknown>, ctx?: Record<string, unknown>) => {
    const success = Boolean(event.success)
    if (!success || !cfg.autoCapture) return

    const messages = Array.isArray(event.messages)
      ? (event.messages as Array<{ role?: string; content?: unknown }>)
      : []

    if (messages.length === 0) return

    const provider = typeof ctx?.messageProvider === 'string' ? ctx.messageProvider : ''
    if (provider === 'exec-event' || provider === 'cron-event') return

    const turn = inferTurnContext(event, ctx)
    onTurnContext?.(turn)

    let resolved = await banks.resolveForTurn(turn)
    const latestUser = latestUserText(messages)
    const extracted = extractAtomicMemories(
      stripInjectedContext(latestUser).trim(),
    )
    if (extracted.length === 0) return

    const writes = extracted.flatMap((captured) => {
      const category = inferMemoryCategory(captured)
      const targets = categoryTargets(category)
      const memoryType = categoryToMemoryType(category)
      const confidence = confidenceForMemoryType(memoryType)

      return targets.map(async (scope) => {
        const bankId = scope === 'shared' ? resolved.sharedBankId : resolved.privateBankId
        const idempotencyKey = buildDeterministicIdempotencyKey(turn, captured, scope)

        const payload = {
          content: captured,
          memory_type: memoryType,
          confidence,
          timestamp: turn.timestampIso,
          idempotency_key: idempotencyKey,
          metadata: {
            schema_version: 'v1',
            tenant_id: turn.tenantId,
            project_id: turn.projectId,
            agent_id: turn.agentId,
            session_id: turn.sessionId,
            turn_id: turn.turnId,
            memory_category: category,
            target_scope: scope,
            source: 'openclaw.agent_end',
          },
        }

        try {
          await client.remember(bankId, payload)
        } catch (error) {
          if (!(error instanceof HippocampusHttpError) || error.status !== 404) {
            throw error
          }

          banks.invalidateByBankId(bankId)
          const refreshed = await banks.resolveForTurn(turn)
          const retryBankId =
            scope === 'shared' ? refreshed.sharedBankId : refreshed.privateBankId
          resolved = refreshed
          await client.remember(retryBankId, payload)
        }
      })
    })

    const settled = await Promise.allSettled(writes)
    for (const result of settled) {
      if (result.status === 'rejected') {
        logger.warn(`capture write failed: ${String(result.reason)}`)
      }
    }

    if (latestUser) {
      weightProfiles.ingestCorrectionSignal(turn, latestUser)
    }
  }
}
