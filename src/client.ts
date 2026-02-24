import type { Logger } from './logger.js'
import { jitterSleepMs } from './utils.js'
import {
  type BankResponse,
  type CreateBankRequest,
  type ListBanksResponse,
  type RecallRequest,
  type RecallResponse,
  type RememberRequest,
  type RememberResponse,
  HippocampusHttpError,
} from './types.js'

type RequestOptions = {
  timeoutMs: number
  retryAttempts: number
}

type ClientOptions = {
  baseUrl: string
  apiKey: string
  recallTimeoutMs: number
  rememberTimeoutMs: number
  requestRetryAttempts: number
  logger: Logger
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HippocampusHttpError) {
    return isRetryableStatus(error.status)
  }
  return true
}

const ALLOWED_MEMORY_TYPES = new Set([
  'world',
  'experience',
  'opinion',
  'observation',
])

export class HippocampusClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly recallTimeoutMs: number
  private readonly rememberTimeoutMs: number
  private readonly requestRetryAttempts: number
  private readonly logger: Logger

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.recallTimeoutMs = options.recallTimeoutMs
    this.rememberTimeoutMs = options.rememberTimeoutMs
    this.requestRetryAttempts = options.requestRetryAttempts
    this.logger = options.logger
  }

  async listBanks(): Promise<ListBanksResponse> {
    return this.requestWithPathFallback<ListBanksResponse>(
      'GET',
      '/banks',
      '/v1/banks',
      undefined,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts,
      },
    )
  }

  async createBank(payload: CreateBankRequest) {
    return this.requestWithPathFallback<BankResponse>(
      'POST',
      '/banks',
      '/v1/banks',
      payload,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts,
      },
    )
  }

  async remember(bankId: string, payload: RememberRequest): Promise<RememberResponse> {
    if (payload.memory_type && !ALLOWED_MEMORY_TYPES.has(payload.memory_type)) {
      throw new Error(
        `Unsupported memory_type '${payload.memory_type}'. Allowed: world|experience|opinion|observation`,
      )
    }

    return this.requestWithPathFallback<RememberResponse>(
      'POST',
      `/banks/${encodeURIComponent(bankId)}/remember`,
      `/v1/banks/${encodeURIComponent(bankId)}/remember`,
      payload,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts,
      },
    )
  }

  async recall(bankId: string, payload: RecallRequest): Promise<RecallResponse> {
    return this.requestWithPathFallback<RecallResponse>(
      'POST',
      `/banks/${encodeURIComponent(bankId)}/recall`,
      `/v1/banks/${encodeURIComponent(bankId)}/recall`,
      payload,
      {
        timeoutMs: this.recallTimeoutMs,
        retryAttempts: this.requestRetryAttempts,
      },
    )
  }

  async deleteMemory(bankId: string, memoryId: string): Promise<{ ok: boolean }> {
    await this.requestWithPathFallback(
      'DELETE',
      `/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(memoryId)}`,
      `/v1/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(memoryId)}`,
      undefined,
      {
        timeoutMs: this.rememberTimeoutMs,
        retryAttempts: this.requestRetryAttempts,
      },
    )
    return { ok: true }
  }

  private async requestWithPathFallback<T>(
    method: string,
    primaryPath: string,
    fallbackPath: string,
    payload: unknown,
    options: RequestOptions,
  ): Promise<T> {
    try {
      return await this.request<T>(method, primaryPath, payload, options)
    } catch (error) {
      if (
        error instanceof HippocampusHttpError &&
        error.status === 404 &&
        primaryPath !== fallbackPath
      ) {
        this.logger.warn(
          `primary endpoint returned 404 for ${method} ${primaryPath}; retrying with ${fallbackPath}`,
        )
        return this.request<T>(method, fallbackPath, payload, options)
      }
      throw error
    }
  }

  private async request<T>(
    method: string,
    path: string,
    payload: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    let lastErr: unknown

    for (let attempt = 0; attempt <= options.retryAttempts; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: payload == null ? undefined : JSON.stringify(payload),
          signal: controller.signal,
        })

        clearTimeout(timeout)
        const text = await response.text()
        const body = text.length > 0 ? safeJsonParse(text) : undefined

        if (!response.ok) {
          const bodyDetail = summarizeErrorBody(body)
          throw new HippocampusHttpError(
            `Hippocampus request failed: ${method} ${path} -> ${response.status}${bodyDetail ? ` (${bodyDetail})` : ''}`,
            {
              status: response.status,
              method,
              path,
              body,
            },
          )
        }

        return (body ?? {}) as T
      } catch (error) {
        clearTimeout(timeout)
        lastErr = error

        if (!isRetryableError(error) || attempt >= options.retryAttempts) {
          throw error
        }

        this.logger.warn(
          `retrying request ${method} ${path} attempt=${attempt + 1}/${options.retryAttempts}`,
        )
        await jitterSleepMs(300, attempt)
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return { message: raw }
  }
}

function summarizeErrorBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const candidate = body as Record<string, unknown>
  const msg =
    (typeof candidate.message === 'string'
      ? candidate.message
      : undefined) ??
    (typeof candidate.error === 'string' ? candidate.error : undefined) ??
    (typeof candidate.details === 'string' ? candidate.details : undefined)
  return msg ?? ''
}
