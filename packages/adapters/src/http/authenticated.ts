import {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
} from './client.js';

export interface AuthenticatedHttpClientOptions extends HttpClientOptions {
  readonly hostname: string;
  readonly headerName: string;
  readonly apiKey: string;
}

/**
 * Bind a credential to one HTTPS hostname. Redirects are rejected so a custom
 * provider header cannot be forwarded to a different origin.
 */
export function createAuthenticatedHttpClient(
  options: AuthenticatedHttpClientOptions,
): HttpClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new TypeError('A provider API key is required.');
  const expectedHostname = options.hostname.toLowerCase();
  const priorPrepare = options.prepareAttempt;
  return createHttpClient({
    ...options,
    async prepareAttempt(url, init) {
      const prepared = priorPrepare ? await priorPrepare(url, init) : init;
      const target = new URL(url);
      if (
        target.protocol !== 'https:' ||
        target.hostname.toLowerCase() !== expectedHostname ||
        target.username.length > 0 ||
        target.password.length > 0
      ) {
        throw new TypeError('Authenticated provider request target was rejected.');
      }
      const headers = new Headers(prepared.headers);
      headers.set(options.headerName, apiKey);
      return { ...prepared, headers, redirect: 'error' };
    },
  });
}
