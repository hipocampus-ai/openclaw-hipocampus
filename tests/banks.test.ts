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
    const createdNames: string[] = []

    const client = {
      async listBanks() {
        listCalls += 1
        return { banks: [], total: 0 }
      },
      async createBank(payload: { name: string }) {
        createCalls += 1
        createdNames.push(payload.name)
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

    expect(first.sharedBankId.toLowerCase()).toContain('shared')
    expect(first.privateBankId.toLowerCase()).toContain('private')
    expect(second).toEqual(first)
    expect(createdNames).toEqual([
      'OpenClaw Project A Shared Memory',
      'OpenClaw Project A Agent A Private Memory',
    ])

    expect(listCalls).toBe(1)
    expect(createCalls).toBe(2)
  })

  it('dedupes concurrent first-time resolve calls for same turn', async () => {
    let listCalls = 0
    let createCalls = 0

    const client = {
      async listBanks() {
        listCalls += 1
        await new Promise((r) => setTimeout(r, 20))
        return { banks: [], total: 0 }
      },
      async createBank(payload: { name: string }) {
        createCalls += 1
        await new Promise((r) => setTimeout(r, 20))
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

    const [one, two] = await Promise.all([
      resolver.resolveForTurn(turn),
      resolver.resolveForTurn(turn),
    ])

    expect(one).toEqual(two)
    expect(listCalls).toBe(1)
    expect(createCalls).toBe(2)
  })
})
