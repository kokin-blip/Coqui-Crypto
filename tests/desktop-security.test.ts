import { describe, expect, it, vi } from 'vitest';

import {
  applyWindowHardening,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isPermissionGranted,
  CONTENT_SECURITY_POLICY,
  EXTERNAL_HOST_ALLOWLIST,
  WEB_PREFERENCES,
  type HardenableWebContents,
} from '../apps/desktop/src/main/security.js';

const APP_ORIGIN = 'http://localhost:5173';

describe('web preferences presence', () => {
  it('sets every flag the renderer sandbox depends on', () => {
    expect(WEB_PREFERENCES).toEqual({
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
    });
  });
});

describe('content security policy presence', () => {
  it('denies by default and forbids every renderer network path', () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split('; ').map((directive) => {
        const [name, ...rest] = directive.split(' ');
        return [name ?? '', rest.join(' ')];
      }),
    );

    expect(directives.get('default-src')).toBe("'none'");
    // Load-bearing: all network I/O belongs to the main process.
    expect(directives.get('connect-src')).toBe("'none'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('frame-src')).toBe("'none'");
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
  });

  it('permits no inline or remote script', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('http:');
    expect(CONTENT_SECURITY_POLICY).not.toContain('*');
  });
});

describe('external navigation (S5)', () => {
  it('accepts only HTTPS hosts on the allowlist', () => {
    expect(isAllowedExternalUrl('https://www.coindesk.com/story')).toBe(true);
    expect(isAllowedExternalUrl('https://sec.gov/news')).toBe(true);
    expect(isAllowedExternalUrl('https://yields.llama.fi/pools')).toBe(true);
  });

  it('rejects every scheme other than https', () => {
    expect(isAllowedExternalUrl('http://www.coindesk.com/story')).toBe(false);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedExternalUrl('coqui://open')).toBe(false);
  });

  it('rejects a host that is not on the allowlist', () => {
    expect(isAllowedExternalUrl('https://evil.example/steal')).toBe(false);
  });

  it('rejects a lookalike host that merely ends with an allowed name', () => {
    expect(isAllowedExternalUrl('https://coindesk.com.evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://notcoindesk.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://evilcoinbase.com/')).toBe(false);
  });

  it('accepts a genuine subdomain of an allowed registrable domain', () => {
    expect(isAllowedExternalUrl('https://api.coinbase.com/v2')).toBe(true);
  });

  it('rejects embedded credentials that disguise the effective host', () => {
    expect(isAllowedExternalUrl('https://coindesk.com@evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pass@evil.example/')).toBe(false);
  });

  it('rejects malformed and oversized input', () => {
    expect(isAllowedExternalUrl('')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl(`https://coindesk.com/${'a'.repeat(4000)}`)).toBe(false);
  });
});

describe('renderer navigation', () => {
  it('permits only the application origin', () => {
    expect(isAllowedNavigation(`${APP_ORIGIN}/scoreboard`, APP_ORIGIN)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('https://www.coindesk.com/', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('', APP_ORIGIN)).toBe(false);
  });

  it('refuses to navigate a packaged file:// renderer to the network', () => {
    const packaged = 'file:///Applications/Coqui.app/renderer/index.html';
    expect(isAllowedNavigation('file:///Applications/Coqui.app/renderer/about.html', packaged)).toBe(true);
    expect(isAllowedNavigation('https://www.coindesk.com/', packaged)).toBe(false);
  });

  it('does not treat an allowlisted external host as a navigable destination', () => {
    // Allowed to open in the browser, never allowed to replace the renderer.
    expect(isAllowedExternalUrl('https://www.coindesk.com/story')).toBe(true);
    expect(isAllowedNavigation('https://www.coindesk.com/story', APP_ORIGIN)).toBe(false);
  });
});

describe('permissions', () => {
  it('denies every permission as policy', () => {
    expect(isPermissionGranted()).toBe(false);
  });
});

describe('applyWindowHardening wiring', () => {
  function harness() {
    const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    const openExternal = vi.fn(async () => {});
    let windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | null = null;
    let permissionRequestHandler:
      | ((permission: string, callback: (granted: boolean) => void) => void)
      | null = null;
    let permissionCheckHandler: (() => boolean) | null = null;
    let headersListener:
      | ((
          details: { responseHeaders?: Record<string, string[]> },
          callback: (response: { responseHeaders: Record<string, string[]> }) => void,
        ) => void)
      | null = null;

    const contents = {
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }) {
        windowOpenHandler = handler;
      },
      on(event: string, listener: (event: { preventDefault(): void }, url: string) => void) {
        listeners.set(event, listener);
      },
      session: {
        setPermissionRequestHandler(
          handler: (permission: string, callback: (granted: boolean) => void) => void,
        ) {
          permissionRequestHandler = handler;
        },
        setPermissionCheckHandler(handler: () => boolean) {
          permissionCheckHandler = handler;
        },
        webRequest: {
          onHeadersReceived(
            listener: (
              details: { responseHeaders?: Record<string, string[]> },
              callback: (response: { responseHeaders: Record<string, string[]> }) => void,
            ) => void,
          ) {
            headersListener = listener;
          },
        },
      },
    } as unknown as HardenableWebContents;

    const installed = applyWindowHardening(contents, APP_ORIGIN, { openExternal });
    return {
      installed,
      listeners,
      openExternal,
      get windowOpenHandler() {
        return windowOpenHandler;
      },
      get permissionRequestHandler() {
        return permissionRequestHandler;
      },
      get permissionCheckHandler() {
        return permissionCheckHandler;
      },
      get headersListener() {
        return headersListener;
      },
    };
  }

  it('installs all five controls', () => {
    const h = harness();
    expect(h.installed).toBe(5);
    expect(h.windowOpenHandler).toBeTypeOf('function');
    expect(h.permissionRequestHandler).toBeTypeOf('function');
    expect(h.permissionCheckHandler).toBeTypeOf('function');
    expect(h.headersListener).toBeTypeOf('function');
    expect(h.listeners.has('will-navigate')).toBe(true);
    expect(h.listeners.has('will-attach-webview')).toBe(true);
  });

  it('always denies the popup, and only opens an allowlisted URL externally', () => {
    const h = harness();
    expect(h.windowOpenHandler?.({ url: 'https://www.coindesk.com/story' })).toEqual({
      action: 'deny',
    });
    expect(h.openExternal).toHaveBeenCalledWith('https://www.coindesk.com/story');

    h.openExternal.mockClear();
    expect(h.windowOpenHandler?.({ url: 'https://evil.example/steal' })).toEqual({
      action: 'deny',
    });
    expect(h.openExternal).not.toHaveBeenCalled();

    h.openExternal.mockClear();
    expect(h.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('prevents a foreign navigation and allows an in-app one', () => {
    const h = harness();
    const listener = h.listeners.get('will-navigate');

    const blocked = { preventDefault: vi.fn() };
    listener?.(blocked, 'https://evil.example/');
    expect(blocked.preventDefault).toHaveBeenCalledOnce();

    const allowed = { preventDefault: vi.fn() };
    listener?.(allowed, `${APP_ORIGIN}/portfolio`);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents any webview from attaching', () => {
    const h = harness();
    const event = { preventDefault: vi.fn() };
    h.listeners.get('will-attach-webview')?.(event, '');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('denies a permission request through the installed handler', () => {
    const h = harness();
    const callback = vi.fn();
    h.permissionRequestHandler?.('media', callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(h.permissionCheckHandler?.()).toBe(false);
  });

  it('stamps the CSP header over anything the response supplied', () => {
    const h = harness();
    const callback = vi.fn();
    h.headersListener?.(
      { responseHeaders: { 'content-type': ['text/html'], 'Content-Security-Policy': ["default-src *"] } },
      callback,
    );
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'content-type': ['text/html'],
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
});

describe('allowlist hygiene', () => {
  it('contains only lowercase registrable hosts with no scheme or path', () => {
    for (const host of EXTERNAL_HOST_ALLOWLIST) {
      expect(host).toBe(host.toLowerCase());
      expect(host).not.toContain('/');
      expect(host).not.toContain(':');
      expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
    expect(new Set(EXTERNAL_HOST_ALLOWLIST).size).toBe(EXTERNAL_HOST_ALLOWLIST.length);
  });
});
