const absoluteFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatLocalTimestamp(atMs: number): string {
  return absoluteFormatter.format(atMs);
}

export function formatLocalTime(atMs: number): string {
  return timeFormatter.format(atMs);
}

export function exactUtcTimestamp(atMs: number): string {
  return new Date(atMs).toISOString();
}

export function formatEvidenceTime(atMs: number | null): string {
  return atMs === null ? 'No persisted observation' : formatLocalTimestamp(atMs);
}
