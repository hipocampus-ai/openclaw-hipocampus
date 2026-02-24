import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'
import { buildRecallHandler } from '../src/hooks/recall.js'
import { HippocampusHttpError } from '../src/types.js'

function logger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe('recall hook 404 recovery', () => {
  it('invalidates and re-resolves bank on 404 and retries once', async () => {
    const calls: string[] = []
    let privateFailedOnce = false

    const client = {
      async recall(bankId: string) {
        calls.push(bankId)

        if (bankId === 'bank_private_old' && !privateFailedOnce) {
          privateFailedOnce = true
          throw new HippocampusHttpError('Bank not found', {
            status: 404,
            method: 'POST',
            path: '/v1/banks/bank_private_old/recall',
            body: { message: 'Bank not found' },
          })
        }

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
                content: 'Recovered memory',
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

    let resolveCount = 0
    let invalidated = ''
    const banks = {
      async resolveForTurn() {
        resolveCount += 1
        if (resolveCount === 1) {
          return { sharedBankId: 'bank_shared', privateBankId: 'bank_private_old' }
        }
        return { sharedBankId: 'bank_shared', privateBankId: 'bank_private_new' }
      },
      invalidateByBankId(bankId: string) {
        invalidated = bankId
      },
    }

    const handler = buildRecallHandler({
      client: client as any,
      cfg: parseConfig({ apiKey: 'hpka_x' }),
      banks: banks as any,
      logger: logger(),
      weightProfiles: {
        get: () => ({ temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 }),
      } as any,
    })

    const output = await handler({
      prompt: 'test query',
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(invalidated).toBe('bank_private_old')
    expect(resolveCount).toBeGreaterThanOrEqual(2)
    expect(calls).toContain('bank_private_new')
    expect((output as any)?.prependContext).toContain('<hippocampus-context>')
  })
})
