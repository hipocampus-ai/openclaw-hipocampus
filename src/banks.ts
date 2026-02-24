import type { HippocampusPluginConfig, ResolvedBanks, TurnContext } from './types.js'
import type { Logger } from './logger.js'
import { renderTemplate } from './utils.js'
import type { HippocampusClient } from './client.js'

type CacheEntry = {
  bankId: string
  expiresAt: number
}

type ResolveOptions = {
  cacheTtlMs?: number
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

export class BankResolver {
  private readonly client: HippocampusClient
  private readonly cfg: HippocampusPluginConfig
  private readonly logger: Logger
  private readonly cache = new Map<string, CacheEntry>()
  private readonly bankIdToKey = new Map<string, string>()
  private readonly inFlight = new Map<string, Promise<ResolvedBanks>>()
  private readonly cacheTtlMs: number

  constructor(
    client: HippocampusClient,
    cfg: HippocampusPluginConfig,
    logger: Logger,
    options?: ResolveOptions,
  ) {
    this.client = client
    this.cfg = cfg
    this.logger = logger
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async resolveForTurn(turn: TurnContext): Promise<ResolvedBanks> {
    const inflightKey = `${turn.projectId}::${turn.agentId}`
    const existing = this.inFlight.get(inflightKey)
    if (existing) return existing

    const task = this.resolveForTurnInternal(turn).finally(() => {
      this.inFlight.delete(inflightKey)
    })
    this.inFlight.set(inflightKey, task)
    return task
  }

  private async resolveForTurnInternal(turn: TurnContext): Promise<ResolvedBanks> {
    const now = Date.now()
    const sharedKey = this.sharedKey(turn)
    const privateKey = this.privateKey(turn)

    const cachedShared = this.cache.get(sharedKey)
    const cachedPrivate = this.cache.get(privateKey)
    if (
      cachedShared &&
      cachedPrivate &&
      cachedShared.expiresAt > now &&
      cachedPrivate.expiresAt > now
    ) {
      return {
        sharedBankId: cachedShared.bankId,
        privateBankId: cachedPrivate.bankId,
      }
    }

    const list = await this.client.listBanks()
    const banks = list.banks ?? []

    const sharedBankId =
      this.pickSharedBankId(banks, turn) ??
      (await this.createSharedBank(turn)).id

    const privateBankId =
      this.pickPrivateBankId(banks, turn) ??
      (await this.createPrivateBank(turn)).id

    this.setCache(sharedKey, sharedBankId)
    this.setCache(privateKey, privateBankId)

    return { sharedBankId, privateBankId }
  }

  invalidateForTurn(turn: TurnContext): void {
    this.cache.delete(this.sharedKey(turn))
    this.cache.delete(this.privateKey(turn))
  }

  invalidateByBankId(bankId: string): void {
    const key = this.bankIdToKey.get(bankId)
    if (key) {
      this.cache.delete(key)
      this.bankIdToKey.delete(bankId)
    }
  }

  private sharedKey(turn: TurnContext): string {
    return `${turn.projectId}::shared`
  }

  private privateKey(turn: TurnContext): string {
    return `${turn.projectId}::agent::${turn.agentId}`
  }

  private setCache(key: string, bankId: string): void {
    this.cache.set(key, {
      bankId,
      expiresAt: Date.now() + this.cacheTtlMs,
    })
    this.bankIdToKey.set(bankId, key)
  }

  private pickSharedBankId(
    banks: Array<{ id: string; name: string; metadata: Record<string, unknown> }>,
    turn: TurnContext,
  ): string | undefined {
    const shared = banks.filter((b) => String(b.metadata?.routing_role ?? '') === 'shared')
    if (shared.length === 0) return undefined

    const exactProject = shared.find(
      (b) => String(b.metadata?.project_id ?? '') === turn.projectId,
    )
    if (exactProject) return exactProject.id

    const sameSource = shared.find(
      (b) => String(b.metadata?.source ?? '') === 'openclaw-hipocampus',
    )
    if (sameSource) return sameSource.id

    return shared[0]?.id
  }

  private pickPrivateBankId(
    banks: Array<{ id: string; name: string; metadata: Record<string, unknown> }>,
    turn: TurnContext,
  ): string | undefined {
    const privateBanks = banks.filter(
      (b) =>
        String(b.metadata?.routing_role ?? '') === 'agent_private' &&
        String(b.metadata?.agent_id ?? '') === turn.agentId,
    )
    if (privateBanks.length === 0) return undefined

    const exactProject = privateBanks.find(
      (b) => String(b.metadata?.project_id ?? '') === turn.projectId,
    )
    if (exactProject) return exactProject.id

    const sameSource = privateBanks.find(
      (b) => String(b.metadata?.source ?? '') === 'openclaw-hipocampus',
    )
    if (sameSource) return sameSource.id

    return privateBanks[0]?.id
  }

  private createSharedBank(turn: TurnContext) {
    this.logger.info(
      `creating shared bank for project=${turn.projectId} tenant=${turn.tenantId}`,
    )
    return this.client.createBank({
      name: this.sharedBankName(turn),
      background: 'OpenClaw shared project memory',
      disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      metadata: {
        routing_role: 'shared',
        project_id: turn.projectId,
        tenant_id: turn.tenantId,
        source: 'openclaw-hipocampus',
      },
    })
  }

  private createPrivateBank(turn: TurnContext) {
    this.logger.info(
      `creating private bank for project=${turn.projectId} agent=${turn.agentId}`,
    )
    return this.client.createBank({
      name: this.privateBankName(turn),
      background: 'OpenClaw private agent memory',
      disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      metadata: {
        routing_role: 'agent_private',
        project_id: turn.projectId,
        tenant_id: turn.tenantId,
        agent_id: turn.agentId,
        source: 'openclaw-hipocampus',
      },
    })
  }

  private sharedBankName(turn: TurnContext): string {
    return renderTemplate(this.cfg.sharedBankNameTemplate, this.templateVars(turn))
  }

  private privateBankName(turn: TurnContext): string {
    return renderTemplate(this.cfg.agentBankNameTemplate, this.templateVars(turn))
  }

  private templateVars(turn: TurnContext): Record<string, string> {
    return {
      tenant_id: turn.tenantId,
      project_id: turn.projectId,
      agent_id: turn.agentId,
      session_id: turn.sessionId,
      tenant_label: toHumanLabel(turn.tenantId, 'Tenant'),
      project_label: toHumanLabel(turn.projectId, 'Project'),
      agent_label: toHumanLabel(turn.agentId, 'Agent'),
      session_label: toHumanLabel(turn.sessionId, 'Session'),
    }
  }
}

function toHumanLabel(input: string, fallback: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return fallback

  if (/^(proj|tenant|sess)_[a-f0-9]{12,}$/i.test(raw)) {
    return fallback
  }

  const cleaned = raw
    .replace(/^oc::/i, '')
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return fallback

  return cleaned
    .split(' ')
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word)) return word
      if (word.length <= 2) return word.toUpperCase()
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
