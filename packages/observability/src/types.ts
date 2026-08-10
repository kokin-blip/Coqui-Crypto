export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SafeLogObject {
  readonly [key: string]: SafeLogValue;
}

export type SafeLogValue =
  | string
  | number
  | boolean
  | null
  | readonly SafeLogValue[]
  | SafeLogObject;

export type LogContext = Readonly<Record<string, unknown>>;

export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly context: SafeLogObject;
}

export type LogSink = (entry: StructuredLogEntry) => void;

export interface LoggerOptions {
  readonly sink?: LogSink;
  readonly minimumLevel?: LogLevel;
  readonly context?: LogContext;
  readonly secrets?: readonly string[];
  readonly timestamp?: () => string;
}

export interface StructuredLogger {
  log(level: LogLevel, event: string, context?: LogContext): void;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  child(context: LogContext): StructuredLogger;
}
