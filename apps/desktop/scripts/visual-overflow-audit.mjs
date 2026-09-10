const TEXT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'p', 'dt', 'dd', 'th', 'td', 'label', 'summary',
  'button', '[role="button"]', '[role="tab"]', '[data-status-indicator]',
  '.panel-empty-body p',
  '.rail-state', '.rail-decision', '.metric-note', '.surface-state strong',
  '.surface-state small', '.evidence-inspector :is(strong, p, dt, dd, span)',
].join(',');

const FOCUSABLE_SELECTOR = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';

function inspectionScript() {
  return `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0 && element.closest('details:not([open]),.sr-only,[aria-hidden="true"]') === null;
    };
    const intentionallyScrollable = (element) => {
      let current = element;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (['auto', 'scroll'].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 2) return true;
        current = current.parentElement;
      }
      return false;
    };
    const clipped = [...document.querySelectorAll(${JSON.stringify(TEXT_SELECTOR)})]
      .filter(visible)
      .filter((element) => {
        if (intentionallyScrollable(element)) return false;
        if (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2) return true;
        const bounds = element.getBoundingClientRect();
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const style = getComputedStyle(ancestor);
          const frame = ancestor.getBoundingClientRect();
          if (['hidden', 'clip'].includes(style.overflowX) && (bounds.left < frame.left - 2 || bounds.right > frame.right + 2)) return true;
          if (['hidden', 'clip'].includes(style.overflowY) && (bounds.top < frame.top - 2 || bounds.bottom > frame.bottom + 2)) return true;
          ancestor = ancestor.parentElement;
        }
        return false;
      })
      .map((element) => ({ selector: element.className || element.tagName.toLowerCase(), text: element.textContent?.trim().slice(0, 80) ?? '', client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }));
    const focusOutside = [...document.querySelectorAll(${JSON.stringify(FOCUSABLE_SELECTOR)})]
      .filter(visible)
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -2 || bounds.right > window.innerWidth + 2;
      })
      .map((element) => ({ element: element.outerHTML.slice(0, 160), bounds: element.getBoundingClientRect().toJSON() }));
    const unnamedIcons = [...document.querySelectorAll('button,a[href]')]
      .filter(visible)
      .filter((element) => (element.textContent?.trim() ?? '') === '' && !element.getAttribute('aria-label') && !element.getAttribute('title') && !element.querySelector('img[alt]:not([alt=""])'))
      .map((element) => element.outerHTML.slice(0, 180));
    return {
      clipped,
      focusOutside,
      unnamedIcons,
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
        ? [document.documentElement.clientWidth, document.documentElement.scrollWidth]
        : null,
    };
  })()`;
}

export async function assertNoTextClipping(webContents, captureName) {
  const result = await webContents.executeJavaScript(inspectionScript());
  const failures = [];
  if (result.clipped.length > 0) failures.push(`clipped text ${JSON.stringify(result.clipped)}`);
  if (result.focusOutside.length > 0) failures.push(`off-canvas controls ${JSON.stringify(result.focusOutside)}`);
  if (result.unnamedIcons.length > 0) failures.push(`unnamed icon controls ${JSON.stringify(result.unnamedIcons)}`);
  if (result.documentOverflow !== null) failures.push(`document overflow ${result.documentOverflow.join(' -> ')}`);
  if (failures.length > 0) throw new Error(`Visual integrity failure in ${captureName}: ${failures.join('; ')}`);
}
