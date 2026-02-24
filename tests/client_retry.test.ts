import { afterEach, describe, expect, it, vi } from 'vitest'

import { HippocampusClient } from '../src/client.js'

function logger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe('HippocampusClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries retryable failures', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'oops' }), { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ banks: [], total: 0 }), { status: 200 }),
      )

    const client = new HippocampusClient({
      baseUrl: 'http://127.0.0.1:8080',
      apiKey: 'hpka_test',
      recallTimeoutMs: 1000,
      rememberTimeoutMs: 1000,
      requestRetryAttempts: 1,
      logger: logger(),
    })

    const response = await client.listBanks()
    expect(response.total).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported memory type before network call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const client = new HippocampusClient({
      baseUrl: 'http://127.0.0.1:8080',
      apiKey: 'hpka_test',
      recallTimeoutMs: 1000,
      rememberTimeoutMs: 1000,
      requestRetryAttempts: 0,
      logger: logger(),
    })

    await expect(
      client.remember('bank_1', {
        content: 'hello',
        memory_type: 'episodic' as any,
      }),
    ).rejects.toThrow(/Unsupported memory_type/)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
