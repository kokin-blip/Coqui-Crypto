import { createElement, type ReactNode } from 'react';

/**
 * Restrained local emphasis adapted from the React Bits interaction pattern.
 * Coqui intentionally uses CSS and its own timing tokens: no GSAP, scroll
 * observer, hidden initial content, continuous loop, or pointer-follow effect.
 */
export function StatusEmphasis({
  children,
  stateKey,
}: {
  readonly children: ReactNode;
  readonly stateKey: string;
}): ReactNode {
  return createElement('span', { key: stateKey, className: 'coqui-status-emphasis' }, children);
}

export function InteractivePanel({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return createElement('div', {
    className: `coqui-interactive-panel ${className}`.trim(),
  }, children);
}
