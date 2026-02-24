import { randomUUID } from 'node:crypto'

import type { TurnContext } from './types.js'
import { toIsoNow } from './utils.js'

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

export function inferTurnContext(
  event: Record<string, unknown>,
  ctx?: Record<string, unknown>,
): TurnContext {
  const c = (ctx ?? {}) as Record<string, unknown>

  const tenantId =
    readString(c, ['tenantId', 'workspaceId']) ??
    readString(event, ['tenantId', 'workspaceId']) ??
    'default_tenant'

  const projectId =
    readString(c, ['projectId', 'project_id']) ??
    readString(event, ['projectId', 'project_id']) ??
    'default_project'

  const agentId =
    readString(c, ['agentId', 'agent_id', 'agentName']) ??
    readString(event, ['agentId', 'agent_id', 'agentName']) ??
    'default_agent'

  const sessionId =
    readString(c, ['sessionId', 'session_id', 'sessionKey']) ??
    readString(event, ['sessionId', 'session_id', 'sessionKey']) ??
    'default_session'

  const turnId =
    readString(event, ['turnId', 'turn_id', 'id']) ??
    readString(c, ['turnId', 'turn_id']) ??
    randomUUID()

  return {
    tenantId,
    projectId,
    agentId,
    sessionId,
    turnId,
    timestampIso: toIsoNow(),
  }
}
