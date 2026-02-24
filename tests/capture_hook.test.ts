import { describe, expect, it } from 'vitest'

import { buildCaptureHandler } from '../src/hooks/capture.js'
import { parseConfig } from '../src/config.js'

function logger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe('capture hook', () => {
  it('writes deterministic payload with required metadata', async () => {
    const writes: Array<{ bankId: string; payload: Record<string, unknown> }> = []

    const client = {
      async remember(bankId: string, payload: Record<string, unknown>) {
        writes.push({ bankId, payload })
        return {
          memory_id: 'm1',
          event_id: 'e1',
          memory_type: 'Opinion',
          bank_id: bankId,
          entities: [],
          relations_created: 0,
          relations_invalidated: 0,
          timestamp: new Date().toISOString(),
          duration_ms: 1,
          extraction_ms: 1,
        }
      },
    }

    const banks = {
      async resolveForTurn() {
        return { sharedBankId: 'bank_shared', privateBankId: 'bank_private' }
      },
      invalidateByBankId() {},
    }

    const handler = buildCaptureHandler({
      client: client as any,
      cfg: parseConfig({ apiKey: 'hpka_x' }),
      banks: banks as any,
      logger: logger(),
      weightProfiles: { ingestCorrectionSignal() {} } as any,
    })

    await handler(
      {
        success: true,
        messages: [
          { role: 'user', content: 'I prefer concise responses and local-first workflow.' },
          { role: 'assistant', content: 'Understood.' },
        ],
      },
      { projectId: 'proj_1', agentId: 'agent_1', sessionKey: 'sess_1', tenantId: 'tenant_1' },
    )

    expect(writes.length).toBeGreaterThan(0)
    const first = writes[0]
    expect(first.bankId).toBe('bank_private')
    expect(String(first.payload.idempotency_key)).toContain('oc:proj_1:agent_1:sess_1')

    const metadata = first.payload.metadata as Record<string, unknown>
    expect(metadata.project_id).toBe('proj_1')
    expect(metadata.agent_id).toBe('agent_1')
    expect(metadata.session_id).toBe('sess_1')
    expect(metadata.source).toBe('openclaw.agent_end')
    expect(String(first.payload.content)).not.toContain('[role:')
    expect(String(first.payload.content)).toContain('User prefers')
  })

  it('does not capture question-only turns with assistant policy output', async () => {
    const writes: Array<{ bankId: string; payload: Record<string, unknown> }> = []

    const client = {
      async remember(bankId: string, payload: Record<string, unknown>) {
        writes.push({ bankId, payload })
        return {
          memory_id: 'm1',
          event_id: 'e1',
          memory_type: 'Opinion',
          bank_id: bankId,
          entities: [],
          relations_created: 0,
          relations_invalidated: 0,
          timestamp: new Date().toISOString(),
          duration_ms: 1,
          extraction_ms: 1,
        }
      },
    }

    const banks = {
      async resolveForTurn() {
        return { sharedBankId: 'bank_shared', privateBankId: 'bank_private' }
      },
      invalidateByBankId() {},
    }

    const handler = buildCaptureHandler({
      client: client as any,
      cfg: parseConfig({ apiKey: 'hpka_x' }),
      banks: banks as any,
      logger: logger(),
      weightProfiles: { ingestCorrectionSignal() {} } as any,
    })

    await handler(
      {
        success: true,
        messages: [
          { role: 'user', content: 'How should you respond and operate for me?' },
          {
            role: 'assistant',
            content:
              'Style: sharp, minimal, direct. Default mode: execution-first unless risky.',
          },
        ],
      },
      { projectId: 'proj_1', agentId: 'agent_1', sessionKey: 'sess_1', tenantId: 'tenant_1' },
    )

    expect(writes).toHaveLength(0)
  })
})
