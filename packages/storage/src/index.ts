/** Operational persistence and immutable research archive adapters. */
export const STORAGE_PACKAGE = '@coqui/storage' as const;
export * from './archive/index.js';
export * from './migrations/index.js';
export * from './profiles/index.js';
export * from './repositories/index.js';
export * from './sqlite/index.js';
