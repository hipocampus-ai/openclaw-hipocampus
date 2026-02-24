import { describe, expect, it } from 'vitest'

import { BankResolver } from '../src/banks.js'
import { parseConfig } from '../src/config.js'

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }
}

describe('BankResolver', () => {
  it('creates and reuses shared/private banks with cache', async () => {
    let listCalls = 0
    let createCalls = 0

    const client = {
      async listBanks() {
        listCalls += 1
        return { banks: [], total: 0 }
      },
      async createBank(payload: { name: string }) {
        createCalls += 1
        return {
          id: `bank_${payload.name}`,
          name: payload.name,
          background: null,
          disposition: { skepticism: 3, literalism: 3, empathy: 3 },
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      },
    }

    const cfg = parseConfig({ apiKey: 'hpka_test' })
    const resolver = new BankResolver(client as any, cfg, makeLogger(), {
      cacheTtlMs: 60_000,
    })

    const turn = {
      tenantId: 'tenant_a',
      projectId: 'project_a',
      agentId: 'agent_a',
      sessionId: 'session_a',
      turnId: '1',
      timestampIso: new Date().toISOString(),
    }

    const first = await resolver.resolveForTurn(turn)
    const second = await resolver.resolveForTurn(turn)

    expect(first.sharedBankId).toContain('shared')
    expect(first.privateBankId).toContain('agent_a')
    expect(second).toEqual(first)

    expect(listCalls).toBe(1)
    expect(createCalls).toBe(2)
  })
})
