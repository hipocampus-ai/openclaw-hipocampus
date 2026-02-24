export type Logger = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

const noop = () => {}

export function createLogger(raw: unknown, debugEnabled: boolean): Logger {
  const logger = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const info = typeof logger.info === 'function' ? (logger.info as Logger['info']) : console.log
  const warn = typeof logger.warn === 'function' ? (logger.warn as Logger['warn']) : console.warn
  const error = typeof logger.error === 'function' ? (logger.error as Logger['error']) : console.error
  const debug =
    debugEnabled && typeof logger.debug === 'function'
      ? (logger.debug as Logger['debug'])
      : debugEnabled
        ? console.debug
        : noop

  return { info, warn, error, debug }
}
