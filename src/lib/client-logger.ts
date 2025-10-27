/**
 * Lightweight client-side logger that avoids lint warnings while providing
 * optional debug output during development.
 */

type LogMethod = (message: string, context?: unknown) => void

const createLoggerMethod =
  (consoleMethod: 'log' | 'warn' | 'error'): LogMethod =>
  (message, context) => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console[consoleMethod](message, context)
    }
  }

export const clientLogger = {
  info: createLoggerMethod('log'),
  warn: createLoggerMethod('warn'),
  error: createLoggerMethod('error')
}

