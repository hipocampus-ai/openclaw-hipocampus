import { describe, expect, it } from 'vitest'

import { decideRouteAndSelect } from '../src/optimizer/single_pass.js'
import type { RecalledMemory } from '../src/types.js'

function memory(partial: Partial<RecalledMemory>): RecalledMemory {
  return {
    id: partial.id ?? 'm1',
    content: partial.content ?? 'Alice is in Seattle.',
    memoryType: partial.memoryType ?? 'world',
    timestamp: partial.timestamp ?? new Date().toISOString(),
    score: partial.score ?? 0.5,
    temporalScore: partial.temporalScore ?? 0.5,
    entityScore: partial.entityScore ?? 0.5,
    meaningScore: partial.meaningScore ?? 0.5,
    pathScore: partial.pathScore ?? 0.5,
    valueMatchScore: partial.valueMatchScore ?? 0.1,
    strategies: partial.strategies ?? ['Meaning'],
    bankId: partial.bankId ?? 'bank_1',
    bankScope: partial.bankScope ?? 'shared',
    metadata: partial.metadata,
  }
}

describe('single-pass optimizer', () => {
  it('keeps route=use for high confidence results', () => {
    const result = decideRouteAndSelect({
      query: 'What does Alice prefer?',
      candidates: [
        memory({ id: 'a', score: 0.95 }),
        memory({ id: 'b', score: 0.7 }),
        memory({ id: 'c', score: 0.4 }),
      ],
      maxResults: 2,
      profile: { temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 },
      confidenceThreshold: 0.62,
      readjustEnabled: true,
    })

    expect(result.route).toBe('use')
    expect(result.selected).toHaveLength(2)
  })

  it('switches to readjust on conflicting low-confidence candidates', () => {
    const result = decideRouteAndSelect({
      query: 'Where is Alice now?',
      candidates: [
        memory({ id: 'a', content: 'Alice is in Seattle.', score: 0.51, temporalScore: 0.2 }),
        memory({ id: 'b', content: 'Alice is in Boston.', score: 0.5, temporalScore: 0.8 }),
        memory({ id: 'c', content: 'General context', score: 0.49, temporalScore: 0.1 }),
      ],
      maxResults: 2,
      profile: { temporal: 0.3, entity: 0.3, meaning: 0.2, path: 0.2 },
      confidenceThreshold: 0.8,
      readjustEnabled: true,
    })

    expect(result.route).toBe('readjust')
    expect(result.selected).toHaveLength(2)
  })
})
