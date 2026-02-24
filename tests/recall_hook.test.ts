import { describe, expect, it } from 'vitest'

import { buildRecallHandler } from '../src/hooks/recall.js'
import { parseConfig } from '../src/config.js'

function logger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe('recall hook', () => {
  it('calls recall once per bank and injects context', async () => {
    const calls: string[] = []

    const client = {
      async recall(bankId: string) {
        calls.push(bankId)
        return {
          operation_id: 'op_1',
          query: 'q',
          stats: {
            temporal_count: 1,
            entity_count: 1,
            meaning_count: 1,
            path_count: 1,
            total_unique: 1,
            final_count: 1,
          },
          memories: [
            {
              memory: {
                id: `mem_${bankId}`,
                content: bankId.includes('shared')
                  ? 'Project Atlas uses TanStack Query.'
                  : 'User prefers concise responses.',
                memory_type: 'world',
                bank_id: bankId,
                timestamp: new Date().toISOString(),
              },
              score: 0.7,
              temporal_score: 0.2,
              entity_score: 0.2,
              meaning_score: 0.2,
              path_score: 0.2,
              value_match_score: 0.1,
              strategies: ['Meaning'],
            },
          ],
        }
      },
    }

    const banks = {
      async resolveForTurn() {
        return { sharedBankId: 'bank_shared', privateBankId: 'bank_private' }
      },
      invalidateByBankId() {},
    }

    const cfg = parseConfig({ apiKey: 'hpka_x', maxRecallResults: 5 })
    const weightProfiles = { get: () => ({ temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 }) }

    const handler = buildRecallHandler({
      client: client as any,
      cfg,
      banks: banks as any,
      logger: logger(),
      weightProfiles: weightProfiles as any,
    })

    const output = await handler({
      prompt: 'How should I proceed?',
      messages: [{ role: 'user', content: 'help me' }],
    })

    expect(calls).toHaveLength(2)
    expect(calls).toEqual(expect.arrayContaining(['bank_shared', 'bank_private']))
    expect((output as any)?.prependContext).toContain('<hippocampus-context>')
  })
})
