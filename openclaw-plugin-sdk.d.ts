declare module 'openclaw/plugin-sdk' {
  export type OpenClawToolDefinition = {
    name: string
    label?: string
    description?: string
    parameters?: unknown
    execute: (toolCallId: string, params: any) => Promise<any>
  }

  export type OpenClawPluginApi = {
    pluginConfig: unknown
    logger: {
      info: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
      debug: (...args: unknown[]) => void
    }
    on: (
      eventName: 'before_agent_start' | 'agent_end' | string,
      handler: (event: Record<string, unknown>, ctx?: Record<string, unknown>) => unknown,
    ) => void
    registerTool: (tool: OpenClawToolDefinition, opts?: { name?: string }) => void
    registerService: (service: {
      id: string
      start?: () => void
      stop?: () => void
    }) => void
  }
}
