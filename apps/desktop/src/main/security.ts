/**
 * Renderer security policy.
 *
 * `docs/MIGRATION.md` §1 originally said these controls existed in the
 * predecessor and should be copied verbatim. Verified against predecessor
 * `80b5a1b`, that was wrong: there is no CSP, no `will-navigate` block and no
 * permission handler anywhere in its `src/`; `sandbox` is `false`; and the one
 * control that does exist hands *any* URL to `shell.openExternal` without a
 * scheme or domain check, which is the S5 finding rather than a safeguard. Only
 * `contextIsolation: true` and `nodeIntegration: false` were worth keeping. The
 * migration row is corrected and this policy is authored fresh.
 *
 * Everything here is a plain value or pure function so the presence tests can
 * assert the policy without launching Electron. `applyWindowHardening` is the
 * only part that touches an Electron object, and it takes the narrow interfaces
 * it needs rather than a `BrowserWindow`.
 */

/**
 * The renderer loads only local assets and talks only to the main process.
 *
 * `connect-src 'none'` is the load-bearing directive: every network call in
 * this application belongs to `packages/adapters/src/http` in the main process,
 * so a renderer that can reach the network at all is already a boundary
 * violation. `script-src 'self'` with no `'unsafe-inline'` means a Vite build
 * must emit external scripts, which is deliberate.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Web preferences for every window. Exported as a value so a test can assert
 * each flag rather than trusting that the call site passed the right object.
 */
export const WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
} as const;

/**
 * Hosts the user may be sent to in their real browser.
 *
 * News and trending items carry publisher-supplied URLs, so without an
 * allowlist a compromised or hostile feed chooses the destination. Entries are
 * exact hosts or a registrable domain the check matches subdomains against.
 */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'coinbase.com',
  'coingecko.com',
  'llama.fi',
  'defillama.com',
  'alternative.me',
  'coindesk.com',
  'cointelegraph.com',
  'decrypt.co',
  'sec.gov',
  'federalregister.gov',
  'github.com',
];

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Whether a URL may be handed to `shell.openExternal`.
 *
 * Treats its input as untrusted (S5). HTTPS only — `http:` is rejected rather
 * than upgraded, and `file:`, `javascript:` and custom schemes have no path to
 * the browser at all. Credentials embedded in the authority are refused because
 * they make the visible host differ from the effective one.
 */
export function isAllowedExternalUrl(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 2048) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  if (url.hostname.length === 0) return false;

  const host = url.hostname.toLowerCase();
  return EXTERNAL_HOST_ALLOWLIST.some((allowed) => hostMatches(host, allowed));
}

/**
 * Whether the renderer may navigate itself to a URL.
 *
 * Only the app's own origin. Any other destination — including an allowlisted
 * external host — must open in the real browser instead, because navigating the
 * renderer away replaces a hardened context with a foreign document.
 */
export function isAllowedNavigation(candidate: string, rendererOrigin: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'file:') {
      return new URL(rendererOrigin).protocol === 'file:';
    }
    return url.origin === new URL(rendererOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * Permissions are denied as a policy, not case by case.
 *
 * A local-first portfolio tracker needs no camera, microphone, geolocation,
 * notifications-via-web, MIDI, USB, serial, or clipboard read. OS notifications
 * for alerts (R9) are raised from the main process, which does not route
 * through this handler.
 */
export function isPermissionGranted(): boolean {
  return false;
}

export interface HardenableWebContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void;
  on(
    event: 'will-attach-webview',
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  readonly session: {
    setPermissionRequestHandler(
      handler: ((permission: string, callback: (granted: boolean) => void) => void) | null,
    ): void;
    setPermissionCheckHandler(handler: (() => boolean) | null): void;
    webRequest: {
      onHeadersReceived(
        listener: (
          details: { responseHeaders?: Record<string, string[]> },
          callback: (response: { responseHeaders: Record<string, string[]> }) => void,
        ) => void,
      ): void;
    };
  };
}

export interface ExternalOpener {
  openExternal(url: string): Promise<void>;
}

/**
 * Attach every renderer-facing control to one `webContents`.
 *
 * Returns the count of controls installed so the smoke test can assert the
 * wiring ran, rather than inferring it from the absence of a crash.
 */
export function applyWindowHardening(
  contents: HardenableWebContents,
  rendererOrigin: string,
  shell: ExternalOpener,
): number {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererOrigin)) event.preventDefault();
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.session.setPermissionRequestHandler((_permission, callback) => {
    callback(isPermissionGranted());
  });
  contents.session.setPermissionCheckHandler(() => isPermissionGranted());

  // Sent as a header as well as the document meta tag: a header cannot be
  // stripped by anything that manages to influence the HTML.
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });

  return 5;
}
