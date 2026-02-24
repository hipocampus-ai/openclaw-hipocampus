import { describe, expect, it } from 'vitest'

import { extractAtomicMemories } from '../src/memory.js'

describe('memory extraction', () => {
  it('does not extract memories from question+instruction prompts', () => {
    const extracted = extractAtomicMemories(
      'For project Helios, what is the canonical data layer and marker? Reply EXACTLY: LAYER=<value>;MARKER=<value or UNKNOWN>.',
    )
    expect(extracted).toEqual([])
  })

  it('extracts concise preference facts from user statements', () => {
    const extracted = extractAtomicMemories('I prefer concise responses and local-first workflow.')
    expect(extracted.some((item) => item.startsWith('User prefers'))).toBe(true)
  })
})
