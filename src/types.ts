export type MemoryType = 'world' | 'experience' | 'opinion' | 'observation'

export type RoutingMode = 'project_agent_hybrid'

export type MemoryCategory =
  | 'preference'
  | 'workflow'
  | 'project_decision'
  | 'fact'

export type BankScope = 'shared' | 'private'

export type TurnContext = {
  tenantId: string
  projectId: string
  agentId: string
  sessionId: string
  turnId: string
  timestampIso: string
}

export type HippocampusPluginConfig = {
  apiKey?: string
  baseUrl: string
  autoRecall: boolean
  autoCapture: boolean
  maxRecallResults: number
  profileFrequency: number
  routingMode: RoutingMode
  sharedBankNameTemplate: string
  agentBankNameTemplate: string
  readjustEnabled: boolean
  readjustConfidenceThreshold: number
  debug: boolean
  recallTimeoutMs: number
  rememberTimeoutMs: number
  requestRetryAttempts: number
}

export type DispositionProfile = {
  skepticism: number
  literalism: number
  empathy: number
}

export type BankMetadata = Record<string, unknown>

export type BankResponse = {
  id: string
  name: string
  background?: string | null
  disposition: DispositionProfile
  metadata: BankMetadata
  created_at: string
  updated_at: string
}

export type ListBanksResponse = {
  banks: BankResponse[]
  total: number
}

export type CreateBankRequest = {
  name: string
  background?: string
  disposition: DispositionProfile
  metadata?: BankMetadata
}

export type RememberRequest = {
  content: string
  memory_type?: MemoryType
  timestamp?: string
  end_timestamp?: string
  confidence?: number
  metadata?: Record<string, unknown>
  idempotency_key?: string
}

export type EntityOutput = {
  id?: string
  name?: string
  entity_type?: string
}

export type RememberResponse = {
  memory_id: string
  event_id: string
  memory_type: string
  bank_id: string
  entities: EntityOutput[]
  relations_created: number
  relations_invalidated: number
  timestamp: string
  duration_ms: number
  extraction_ms: number
}

export type RecallRequest = {
  query: string
  k_results: number
  k_per_strategy: number
  temporal_weight: number
  entity_weight: number
  meaning_weight: number
  path_weight: number
  rerank: boolean
  query_intent_mode: 'auto'
  temporal_supersession_enabled: boolean
  consistency_mode: 'strong' | 'eventual'
}

export type MemoryRecordResponse = {
  id: string
  content: string
  memory_type: string
  bank_id: string
  timestamp: string
  end_timestamp?: string | null
  confidence?: number | null
  status?: string
  salience?: number
  content_hash?: string
  duplicate_of?: string | null
  duplicate_count?: number
  source_uri?: string | null
  source_type?: string | null
  trust_score?: number
  provenance?: Record<string, unknown> | null
  entity_ids?: string[]
  evidence_ids?: string[]
  updated_at?: string
}

export type MemoryResultResponse = {
  memory: MemoryRecordResponse
  score: number
  temporal_score: number
  entity_score: number
  meaning_score: number
  path_score: number
  value_match_score?: number
  strategies: string[]
}

export type RecallStats = {
  temporal_count: number
  entity_count: number
  meaning_count: number
  path_count: number
  total_unique: number
  final_count: number
}

export type RecallResponse = {
  operation_id: string
  query: string
  memories: MemoryResultResponse[]
  stats: RecallStats
}

export type RecalledMemory = {
  id: string
  content: string
  memoryType: string
  timestamp: string
  score: number
  temporalScore: number
  entityScore: number
  meaningScore: number
  pathScore: number
  valueMatchScore: number
  strategies: string[]
  bankId: string
  bankScope: BankScope
  metadata?: Record<string, unknown>
}

export type WeightProfile = {
  temporal: number
  entity: number
  meaning: number
  path: number
}

export type RouteDecision = {
  route: 'use' | 'readjust'
  confidence: number
  selected: RecalledMemory[]
  reason: string
}

export type ResolvedBanks = {
  sharedBankId: string
  privateBankId: string
}

export class HippocampusHttpError extends Error {
  readonly status: number
  readonly method: string
  readonly path: string
  readonly body: unknown

  constructor(
    message: string,
    options: { status: number; method: string; path: string; body: unknown },
  ) {
    super(message)
    this.name = 'HippocampusHttpError'
    this.status = options.status
    this.method = options.method
    this.path = options.path
    this.body = options.body
  }
}

export type ToolSearchResult = {
  id: string
  content: string
  similarity?: number
  metadata?: Record<string, unknown>
}
