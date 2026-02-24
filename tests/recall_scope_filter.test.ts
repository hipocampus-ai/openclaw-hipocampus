import { describe, expect, it } from 'vitest'

import { buildRecallHandler } from '../src/hooks/recall.js'
import { parseConfig } from '../src/config.js'

function logger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe('recall scope filtering', () => {
  it('drops leaked private-style memories from shared recall', async () => {
    const client = {
      async recall(bankId: string) {
        if (bankId === 'bank_shared') {
          return {
            operation_id: 'op_shared',
            query: 'q',
            stats: {
              temporal_count: 2,
              entity_count: 2,
              meaning_count: 2,
              path_count: 2,
              total_unique: 2,
              final_count: 2,
            },
            memories: [
              {
                memory: {
                  id: 'leaked_private',
                  content: 'Private operating preference for this agent only: marker LEAKED_X.',
                  memory_type: 'opinion',
                  bank_id: bankId,
                  timestamp: new Date().toISOString(),
                  provenance: { target_scope: 'shared' },
                },
                score: 0.9,
                temporal_score: 0.2,
                entity_score: 0.2,
                meaning_score: 0.2,
                path_score: 0.2,
                value_match_score: 0.1,
                strategies: ['Meaning'],
              },
              {
                memory: {
                  id: 'shared_project',
                  content: 'Project decision: use Drizzle for Orion.',
                  memory_type: 'world',
                  bank_id: bankId,
                  timestamp: new Date().toISOString(),
                  provenance: { target_scope: 'shared' },
                },
                score: 0.8,
                temporal_score: 0.2,
                entity_score: 0.2,
                meaning_score: 0.2,
                path_score: 0.2,
                value_match_score: 0.1,
                strategies: ['Meaning'],
              },
            ],
          }
        }

        return {
          operation_id: 'op_private',
          query: 'q',
          stats: {
            temporal_count: 0,
            entity_count: 0,
            meaning_count: 0,
            path_count: 0,
            total_unique: 0,
            final_count: 0,
          },
          memories: [],
        }
      },
    }

    const banks = {
      async resolveForTurn() {
        return { sharedBankId: 'bank_shared', privateBankId: 'bank_private' }
      },
      invalidateByBankId() {},
    }

    const handler = buildRecallHandler({
      client: client as any,
      cfg: parseConfig({ apiKey: 'hpka_x', maxRecallResults: 5 }),
      banks: banks as any,
      logger: logger(),
      weightProfiles: {
        get: () => ({ temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 }),
      } as any,
    })

    const output = await handler({
      prompt: 'What should we use for Orion?',
      messages: [{ role: 'user', content: 'question' }],
    })

    const context = (output as any)?.prependContext ?? ''
    expect(context).toContain('Project decision: use Drizzle for Orion.')
    expect(context).not.toContain('LEAKED_X')
  })
})

