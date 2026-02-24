import { describe, expect, it } from 'vitest'

import { categoryTargets, inferMemoryCategory } from '../src/memory.js'

describe('memory routing', () => {
  it('routes explicit project decisions to shared', () => {
    const category = inferMemoryCategory(
      'Project decision for Nebula: canonical ORM is Prisma.',
    )
    expect(category).toBe('project_decision')
    expect(categoryTargets(category)).toEqual(['shared'])
  })

  it('routes explicit private preference statements to private', () => {
    const category = inferMemoryCategory(
      'Private operating preference for this agent only: marker ALPHA_PRIVATE_1.',
    )
    expect(category).toBe('preference')
    expect(categoryTargets(category)).toEqual(['private'])
  })

  it('routes generic uncategorized facts to private by default', () => {
    const category = inferMemoryCategory('Marker ABC123 is active for this user.')
    expect(category).toBe('fact')
    expect(categoryTargets(category)).toEqual(['private'])
  })
})

