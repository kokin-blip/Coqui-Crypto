import { setTimeout as delay } from 'node:timers/promises';

/** Exercises the production terminal through its ordinary controls. */
export async function checkTerminal(window, check) {
  const evaluate = (source, gesture = false) => window.webContents.executeJavaScript(source, gesture);
  const waitFor = async (source) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(source)) return;
      await delay(50);
    }
    throw new Error(`Terminal control did not settle: ${source}`);
  };
  await evaluate(`location.hash = '#/overview'`);
  await waitFor(`document.querySelector('[aria-label="Account and algorithm data"]') !== null`);
  for (const tab of ['Assets', 'Paper Positions', 'Paper Proposals', 'Decisions', 'Performance', 'Research Runs']) {
    await evaluate(`document.querySelector('[aria-label="Account and algorithm data"]')?.querySelectorAll('button').forEach(b => { if (b.textContent === ${JSON.stringify(tab)}) b.click(); })`);
    await waitFor(`document.querySelector('#terminal-data-panel')?.getAttribute('aria-labelledby') === document.querySelector('[aria-label="Account and algorithm data"] [aria-selected="true"]')?.id`);
    check(`terminal ${tab} tab selects its labelled panel`, true);
    if (tab === 'Paper Proposals') {
      await waitFor(`document.querySelector('#terminal-data-panel')?.textContent.includes('Reconcile before retrying') && document.querySelector('#terminal-data-panel')?.textContent.includes('risk unassessed')`);
      check('terminal proposal rows preserve blocked and unknown execution guidance', true);
    }
  }
  await evaluate(`(() => {
    const tabs = document.querySelector('[aria-label="Account and algorithm data"]');
    const current = tabs.querySelector('[aria-selected="true"]');
    current.focus(); current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  })()`);
  await waitFor(`document.activeElement?.id === 'terminal-data-tab-0' && document.activeElement?.getAttribute('aria-selected') === 'true'`);
  check('terminal tabs support keyboard navigation and focus', true);

  await waitFor(`[...(document.querySelector('select[aria-label="Order book market"]')?.options ?? [])].some(o => o.value === 'ETH-USD')`);
  await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Order book market"]');
    select.value = 'ETH-USD'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(`document.querySelector('.chart-tile-label select')?.value === 'ETH-USD'`);
  await evaluate(`document.querySelector('#terminal-data-tab-3').click()`);
  await waitFor(`document.querySelector('#terminal-data-panel')?.textContent.includes('ETH-USD decisions')`);
  check('terminal links product selection to chart and decision evidence', true);
  await evaluate(`document.querySelector('#terminal-chart-tab-1').click(); document.querySelector('#microstructure-tab-1').click()`);
  await waitFor(`document.querySelector('#terminal-chart-panel')?.textContent.includes('ETH-USD') && document.querySelector('#microstructure-tab-1')?.getAttribute('aria-selected') === 'true'`);
  check('terminal depth and recent-trades views retain the selected product', true);
  await evaluate(`document.querySelector('#terminal-chart-tab-0').click()`);
  await evaluate(`document.querySelector('button[aria-label="Fullscreen chart panel"]').click()`, true);
  await waitFor(`document.fullscreenElement?.classList.contains('terminal-price-panel') === true`);
  await evaluate(`document.querySelector('button[aria-label="Exit chart fullscreen"]').click()`, true);
  await waitFor(`document.fullscreenElement === null`);
  check('terminal chart panel enters and exits native fullscreen', true);

  window.setContentSize(1440, 900);
  await delay(80);
  await evaluate(`document.querySelector('button[aria-label="Open algorithm and evidence"]').focus(); document.querySelector('button[aria-label="Open algorithm and evidence"]').click()`);
  await waitFor(`document.querySelector('.terminal-drawer')?.contains(document.activeElement) === true`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(`document.querySelector('.terminal-drawer') === null && document.activeElement?.getAttribute('aria-label') === 'Open algorithm and evidence'`);
  check('terminal evidence drawer traps and restores keyboard focus', true);
}
