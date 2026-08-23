import { sha256Hex, type Clock } from '@coqui/core';
import { createStructuredLogger, type StructuredLogger } from '@coqui/observability';
import { appendRuntimeIncident, type Db, type RuntimeIncident } from '@coqui/storage';

/**
 * Where a background failure goes.
 *
 * Two things existed and neither had a production caller.
 * `createStructuredLogger` — with a redaction layer nothing used — was imported
 * zero times by the main process. `appendRuntimeIncident` and the append-only
 * `runtime_incidents` table were written only by the reconciliation harness.
 * So a failed paper tick, a refused migration or a dead provider produced
 * exactly nothing a user or a maintainer could find afterwards.
 *
 * P9's exit criterion is that a background failure is diagnosable **from logs
 * alone**. This is the seam that makes that true: one function, called from
 * every `onUnexpectedError` hook in the application, that writes a structured
 * line and — for failures a user should know happened — an incident row.
 */

/** Contexts that describe a durable fault, and the incident kind each becomes. */
const INCIDENT_KINDS: Readonly<Record<string, RuntimeIncident['kind']>> = {
  scheduler_tick: 'scheduler_failure',
  scheduler_ensure: 'scheduler_failure',
  scheduler_prepare: 'scheduler_failure',
  paper_recovery: 'execution_fault',
  paper_run: 'execution_fault',
  paper_market_bars: 'provider_invalid',
  paper_market_rules: 'provider_invalid',
  alert_notifications: 'worker_failure',
};

/**
 * A transient network blip is not an incident.
 *
 * An incident row is permanent and surfaces to the user, so the bar is "this
 * needs looking at", not "this went wrong once". Everything still reaches the
 * log; only durable faults reach the table. Logging everything and recording
 * some is the asymmetry that keeps the incident list worth reading.
 */
function incidentKindFor(context: string): RuntimeIncident['kind'] | null {
  return INCIDENT_KINDS[context] ?? null;
}

/**
 * A stable, secret-free description.
 *
 * The error's own message never reaches the incident detail — an upstream
 * message can carry a URL with a key in it (invariant 3). The log line gets the
 * message because the log is local; the row gets the constructor name, which is
 * enough to tell a `TypeError` from a `RangeError` without carrying content.
 */
function errorShape(error: unknown): string {
  if (error instanceof Error) return error.constructor.name;
  return typeof error;
}

export interface DiagnosticsDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly profileId: string;
  readonly logger?: StructuredLogger;
  /** Redacted from every log line even if it somehow reaches one. */
  readonly secrets?: readonly string[];
}

export interface Diagnostics {
  readonly logger: StructuredLogger;
  /** Record a background failure. Never throws, whatever the sink does. */
  report(context: string, error: unknown): void;
}

export function createDiagnostics(dependencies: DiagnosticsDependencies): Diagnostics {
  const logger = dependencies.logger ?? createStructuredLogger({
    context: { profileId: dependencies.profileId },
    // The redaction layer was already good; it simply had no caller. Any
    // connected key is passed here so a line that should never contain it
    // cannot, rather than relying on nobody having logged the wrong object.
    secrets: dependencies.secrets ?? [],
  });

  return {
    logger,
    report(context, error) {
      // The whole body is guarded. Diagnostics reporting a failure must not be
      // able to produce a second one.
      try {
        logger.error('background_failure', {
          context,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } catch {
        // A broken sink cannot be reported through the sink.
      }

      const kind = incidentKindFor(context);
      if (kind === null) return;

      try {
        const occurredAt = dependencies.clock.nowMs();
        appendRuntimeIncident(
          {
            // Derived from the context and the minute, so a failure repeating
            // every tick produces one row a minute rather than one per tick —
            // and an incident list nobody can read is an incident list nobody
            // reads.
            id: sha256Hex(`diagnostic:${context}:${Math.floor(occurredAt / 60_000)}`),
            profileId: dependencies.profileId,
            runId: null,
            kind,
            severity: 'warning',
            source: context,
            detailJson: JSON.stringify({ context, errorType: errorShape(error) }),
            occurredAt,
            resolvedAt: null,
            resolution: null,
          },
          dependencies.database,
        );
      } catch {
        // The log line already landed, which is the guarantee that matters.
      }
    },
  };
}
