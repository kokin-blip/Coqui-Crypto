const TEXT_SELECTOR = [
  '.panel-empty-body p',
  '[data-status-indicator]',
  '[data-status-indicator] > *',
  '.evidence-stack :is(h2, strong, p, dt, dd, span)',
  '.strategy-detail :is(h2, h3, strong, p, dt, dd, span)',
  '.overview-recent :is(h2, strong, p, span)',
  '.overview-proposal :is(h2, p)',
  '.overview-health :is(strong, span, p)',
  '.overview-negative :is(h2, h3, strong, p, span)',
].join(',');

export async function assertNoTextClipping(webContents, captureName) {
  const clipped = await webContents.executeJavaScript(`
    (() => [...document.querySelectorAll(${JSON.stringify(TEXT_SELECTOR)})]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (element.closest('details:not([open])') !== null) return false;
        // Chromium can report a two-pixel glyph-overhang for large variable-font
        // numerals even when the line box is fully visible. Anything beyond that
        // is a real clipping failure.
        if (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2) return true;
        const bounds = element.getBoundingClientRect();
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const ancestorStyle = getComputedStyle(ancestor);
          const clipsX = ['hidden', 'clip'].includes(ancestorStyle.overflowX);
          const clipsY = ['hidden', 'clip'].includes(ancestorStyle.overflowY);
          if (clipsX || clipsY) {
            const frame = ancestor.getBoundingClientRect();
            if ((clipsX && (bounds.left < frame.left - 2 || bounds.right > frame.right + 2)) ||
                (clipsY && (bounds.top < frame.top - 2 || bounds.bottom > frame.bottom + 2))) return true;
          }
          ancestor = ancestor.parentElement;
        }
        return false;
      })
      .map((element) => ({
        selector: element.className || element.tagName.toLowerCase(),
        text: element.textContent?.trim().slice(0, 80) ?? '',
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
        clippingAncestors: (() => {
          const bounds = element.getBoundingClientRect();
          const result = [];
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== document.body) {
            const style = getComputedStyle(ancestor);
            if (['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)) {
              const frame = ancestor.getBoundingClientRect();
              result.push({
                selector: ancestor.className || ancestor.tagName.toLowerCase(),
                delta: [bounds.left - frame.left, frame.right - bounds.right, bounds.top - frame.top, frame.bottom - bounds.bottom],
              });
            }
            ancestor = ancestor.parentElement;
          }
          return result;
        })(),
      })))()
  `);
  if (clipped.length > 0) {
    throw new Error(`Text clipping detected in ${captureName}: ${JSON.stringify(clipped)}`);
  }
}
