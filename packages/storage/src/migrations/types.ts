/** Minimal database surface used by the preserved predecessor migrations. */
export interface MigrationDatabase {
  exec(sql: string): void;
}

/** A single forward-only schema migration. */
export interface Migration {
  /** 1-based version this migration brings the database to. */
  readonly version: number;
  readonly name: string;
  readonly up: (database: MigrationDatabase) => void;
}
