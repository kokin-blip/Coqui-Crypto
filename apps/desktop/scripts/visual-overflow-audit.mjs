const TEXT_SELECTOR = [
  '.panel-empty-body p',
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
        // Chromium can report a two-pixel glyph-overhang for large variable-font
        // numerals even when the line box is fully visible. Anything beyond that
        // is a real clipping failure.
        return element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2;
      })
      .map((element) => ({
        selector: element.className || element.tagName.toLowerCase(),
        text: element.textContent?.trim().slice(0, 80) ?? '',
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
      })))()
  `);
  if (clipped.length > 0) {
    throw new Error(`Text clipping detected in ${captureName}: ${JSON.stringify(clipped)}`);
  }
}
