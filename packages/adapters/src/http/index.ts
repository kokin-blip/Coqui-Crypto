/** The only application boundary permitted to issue global HTTP requests. */
export const HTTP_ADAPTER_BOUNDARY = 'http' as const;

export * from './client.js';
export * from './authenticated.js';
export * from './rate-limiter.js';
