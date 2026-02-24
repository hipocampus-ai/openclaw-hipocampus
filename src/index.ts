import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

import { BankResolver } from './banks.js'
import { HippocampusClient } from './client.js'
import { parseConfig, hippocampusConfigSchema } from './config.js'
import { buildCaptureHandler } from './hooks/capture.js'
import { buildRecallHandler } from './hooks/recall.js'
import { createLogger } from './logger.js'
import { WeightProfiles } from './state/weight_profiles.js'
import { inferTurnContext } from './turn_context.js'
import { registerForgetTool } from './tools/forget.js'
import { registerProfileTool } from './tools/profile.js'
import { registerSearchTool } from './tools/search.js'
import { registerStoreTool } from './tools/store.js'
import type { TurnContext } from './types.js'

export default {
  id: 'openclaw-hipocampus',
  name: 'Hippocampus',
  description: 'OpenClaw memory plugin powered by Hippocampus',
  kind: 'memory' as const,
  configSchema: hippocampusConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig)
    const logger = createLogger(api.logger, cfg.debug)

    if (!cfg.apiKey) {
      logger.info(
        'hippocampus: missing api key, set HIPPOCAMPUS_OPENCLAW_API_KEY or plugin config.apiKey',
      )
      return
    }

    const client = new HippocampusClient({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      recallTimeoutMs: cfg.recallTimeoutMs,
      rememberTimeoutMs: cfg.rememberTimeoutMs,
      requestRetryAttempts: cfg.requestRetryAttempts,
      logger,
    })

    const banks = new BankResolver(client, cfg, logger)
    const weightProfiles = new WeightProfiles()

    let latestTurn: TurnContext | undefined
    const setTurnContext = (turn: TurnContext) => {
      latestTurn = turn
    }

    const getTurnContext = (): TurnContext => {
      if (latestTurn) return latestTurn
      return inferTurnContext({}, {})
    }

    if (cfg.autoRecall) {
      api.on(
        'before_agent_start',
        buildRecallHandler({
          client,
          cfg,
          banks,
          logger,
          weightProfiles,
          onTurnContext: setTurnContext,
        }),
      )
    }

    if (cfg.autoCapture) {
      api.on(
        'agent_end',
        buildCaptureHandler({
          client,
          cfg,
          banks,
          logger,
          weightProfiles,
          onTurnContext: setTurnContext,
        }),
      )
    }

    registerStoreTool({ api, client, banks, logger, getTurnContext })
    registerSearchTool({ api, client, banks, logger, getTurnContext })
    registerForgetTool({ api, client, banks, logger, getTurnContext })
    registerProfileTool({ api, client, banks, logger, getTurnContext })

    api.registerService({
      id: 'openclaw-hipocampus',
      start: () => logger.info('hippocampus: connected'),
      stop: () => logger.info('hippocampus: stopped'),
    })
  },
}
