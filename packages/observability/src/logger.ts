import { sanitizeLogContext } from './redaction.js';
import type {
  LogContext,
  LogLevel,
  LogSink,
  LoggerOptions,
  StructuredLogger,
} from './types.js';

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10, info: 20, warn: 30, error: 40,
};
const EVENT_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

const consoleSink: LogSink = (entry) => {
  console.log(JSON.stringify(entry));
};

function assertEvent(event: string): void {
  if (event.length > 100 || !EVENT_PATTERN.test(event)) {
    throw new TypeError('Log events must be stable lowercase identifiers of at most 100 characters.');
  }
}

function mergeContext(base: LogContext, extra: LogContext | undefined): LogContext {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const copy = (source: LogContext): void => {
    let keys: string[];
    try {
      keys = Object.keys(source);
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        result[key] = descriptor && 'value' in descriptor
          ? descriptor.value
          : '[Accessor omitted]';
      } catch {
        result[key] = '[Unreadable]';
      }
    }
  };
  copy(base);
  if (extra) copy(extra);
  return result;
}

function loggerFor(options: Required<Pick<LoggerOptions, 'minimumLevel' | 'sink' | 'timestamp'>> & {
  readonly context: LogContext;
  readonly secrets: readonly string[];
}): StructuredLogger {
  const log = (level: LogLevel, event: string, context?: LogContext): void => {
    assertEvent(event);
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.minimumLevel]) return;
    try {
      const entry = Object.freeze({
        timestamp: options.timestamp(),
        level,
        event,
        context: Object.freeze(sanitizeLogContext(mergeContext(options.context, context), options.secrets)),
      });
      options.sink(entry);
    } catch {
      // Telemetry failure must never change application control flow.
    }
  };
  return Object.freeze({
    log,
    debug: (event: string, context?: LogContext) => log('debug', event, context),
    info: (event: string, context?: LogContext) => log('info', event, context),
    warn: (event: string, context?: LogContext) => log('warn', event, context),
    error: (event: string, context?: LogContext) => log('error', event, context),
    child: (context: LogContext) => loggerFor({
      ...options,
      context: mergeContext(options.context, context),
    }),
  });
}

export function createStructuredLogger(options: LoggerOptions = {}): StructuredLogger {
  return loggerFor({
    sink: options.sink ?? consoleSink,
    minimumLevel: options.minimumLevel ?? 'info',
    timestamp: options.timestamp ?? (() => new Date().toISOString()),
    context: options.context ?? {},
    secrets: Object.freeze([...(options.secrets ?? [])]),
  });
}

export const NOOP_LOGGER: StructuredLogger = createStructuredLogger({
  minimumLevel: 'error',
  sink: () => undefined,
});
