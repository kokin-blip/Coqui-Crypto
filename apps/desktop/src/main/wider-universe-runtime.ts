import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAlpacaPaperClient, fetchCoinbaseUniverseProducts, fetchCoinbaseQuote,
  fetchCoinbaseBook, fetchCoinbaseProduct, parseAlpacaUniverseAssets, parseAlpacaUniverseLiquidity,
  type HttpClient, type SecretStore } from '@coqui/adapters';
import { createWiderUniverseStudy, evaluateUniverseAsset, instrumentKey, mapUniverseProducts,
  planUniverseShadow, universeHash, universeStrategyInput, validateUniversePolicy,
  UNIVERSE_DAY, WIDER_UNIVERSE_POLICY, type Clock, type UniverseAssetEvidence,
  type UniverseObservation, type UniversePolicy, type UniverseProductObservation, type UniverseAlpacaAsset } from '@coqui/core';
import { appendUniverseRecord, getSetting, hasUniverseRecord, latestParallelExperiment, listUniverseRecords,
  listParallelEvents, parallelExperimentStatus, type Db } from '@coqui/storage';
import type { createHistoricalCoinbaseCandleSource } from './coinbase-candle-source.js';

interface Catalog { observedAtMs: number; products: UniverseProductObservation[]; assets: UniverseAlpacaAsset[] }
/** Hash the installed implementation, including dirty-source builds, without reading credentials. */
export function widerUniverseRuntimeSourceHash(): string {
  const roots = [dirname(fileURLToPath(import.meta.url)), ...['@coqui/core', '@coqui/adapters', '@coqui/storage']
    .map((name) => dirname(fileURLToPath(import.meta.resolve(name))))];
  const material: [string, string][] = [];
  const visit = (root: string, relative: string, label: number) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(root, path, label);
      else if (entry.isFile() && /\.(js|ts)$/u.test(path) && !path.endsWith('.d.ts')) material.push([`${label}/${path}`, readFileSync(join(root, path), 'utf8')]);
    }
  };
  roots.forEach((root, index) => visit(root, '', index));
  return universeHash(material);
}

/** Read-only acquisition in main. No submission capability is passed to research or shadow planning. */
export function createWiderUniverseRuntime(input: { profileId: string; database: Db; clock: Clock;
  http: HttpClient; candleSource: ReturnType<typeof createHistoricalCoinbaseCandleSource>;
  secrets?: SecretStore; onUnexpectedError: (context: string, error: unknown) => void;
  clientFactory?: typeof createAlpacaPaperClient; sourceContentHash?: string }) {
  let busy = false, sourceHash: string | null = null;
  const records = (kind: Parameters<typeof listUniverseRecords>[1]) => {
    const now = input.clock.nowMs();
    const from = kind === 'catalog' ? (Math.floor(now / UNIVERSE_DAY) - 1) * UNIVERSE_DAY
      : ['observation', 'frame', 'shadow', 'failure'].includes(kind) ? Math.floor(now / (UNIVERSE_DAY / 6)) * (UNIVERSE_DAY / 6) : 0;
    return listUniverseRecords(input.profileId, kind, input.database, Number.MAX_SAFE_INTEGER, from);
  };
  const append = (kind: Parameters<typeof appendUniverseRecord>[1]['kind'], key: string, atMs: number, body: unknown) =>
    appendUniverseRecord(input.profileId, { kind, key, atMs, body }, input.database);
  return { async refresh(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const started = input.clock.nowMs(), dayMs = Math.floor(started / UNIVERSE_DAY) * UNIVERSE_DAY;
      const slotMs = Math.floor(started / (UNIVERSE_DAY / 6)) * (UNIVERSE_DAY / 6);
      if (hasUniverseRecord(input.profileId, 'frame', String(slotMs), input.database) ||
          (started - slotMs >= 900_000 && hasUniverseRecord(input.profileId, 'catalog', String(dayMs), input.database))) return;
      const experiment = latestParallelExperiment(input.profileId, input.database);
      if (!experiment || !input.secrets) return;
      if (parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.database)) === 'stopped') return;
      const rawPolicy = getSetting('research.widerUniverse.policy', input.database);
      const policy: UniversePolicy = rawPolicy === null ? WIDER_UNIVERSE_POLICY : JSON.parse(rawPolicy) as UniversePolicy;
      validateUniversePolicy(policy);
      const policyHash = universeHash(policy);
      if (!records('policy').some((r) => r.key === policyHash)) append('policy', policyHash, started, policy);
      if (!records('study').some((r) => r.key === policyHash)) {
        sourceHash ??= input.sourceContentHash ?? widerUniverseRuntimeSourceHash();
        append('study', policyHash, started, createWiderUniverseStudy(started, sourceHash, experiment.anchor, policy));
      }
      const stored = await input.secrets.read('alpaca-paper-credentials', input.profileId);
      if (!stored.ok || stored.value === null) throw new Error('universe_credentials_unavailable');
      const credentials = JSON.parse(stored.value) as { keyId: string; secretKey: string };
      const client = (input.clientFactory ?? createAlpacaPaperClient)(credentials);
      const account = await client.account();
      const accountAtMs = input.clock.nowMs();
      const accountReady = account.id === experiment.alpacaAccountId && account.id === getSetting('alpaca.paper.account.id', input.database) &&
        ['ACTIVE', 'PAPER_ONLY'].includes(account.status) && account.currency === 'USD' && !account.trading_blocked && !account.account_blocked;
      if (!records('catalog').some((r) => r.key === String(dayMs))) {
        const [coinbase, assets] = await Promise.all([fetchCoinbaseUniverseProducts(input.http), client.cryptoAssets()]);
        if (!coinbase.ok) throw new Error('universe_catalog_unavailable');
        const atMs = input.clock.nowMs();
        if (Math.floor(atMs / UNIVERSE_DAY) * UNIVERSE_DAY !== dayMs) return;
        append('catalog', String(dayMs), atMs, { observedAtMs: atMs, products: coinbase.data, assets });
      }
      const prior = records('catalog').find((r) => r.key === String(dayMs - UNIVERSE_DAY));
      if (!prior) { if (!hasUniverseRecord(input.profileId, 'failure', `prior:${dayMs}`, input.database)) append('failure', `prior:${dayMs}`, started,
        { reason: 'missing_prior_day_catalog', policyHash }); return; }
      const catalog = prior.body as Catalog;
      if (started - slotMs >= 900_000) return;
      if (records('frame').some((r) => r.key === String(slotMs))) return;
      const mapped = mapUniverseProducts(catalog.products, catalog.assets);
      const already = new Set(records('observation').filter((r) => r.key.startsWith(`${slotMs}:`)).map((r) => r.key));
      const pending = mapped.filter((m) => !already.has(`${slotMs}:${instrumentKey(m.product.instrument)}`));
      // Unsupported assets need no network calls; capture their exclusion alongside the complete catalog.
      for (const m of pending.filter((m) => m.mapping === null)) {
        const atMs = input.clock.nowMs();
        if (atMs >= slotMs + 900_000) return;
        const evidence: UniverseAssetEvidence = { ...m, mappingReason: m.reason, catalogObservedAtMs: catalog.observedAtMs,
          accountObservedAtMs: accountAtMs, accountReady, bars: [], listedAtMs: null, coinbase: null, alpaca: null,
          currentProduct: null, currentAsset: null, rulesObservedAtMs: atMs };
        append('observation', `${slotMs}:${instrumentKey(m.product.instrument)}`, atMs, { slotMs, catalogHash: prior.hash, atMs, evidence });
      }
      // Four products per scheduler pass; retries resume from durable per-slot records after restart.
      await Promise.all(pending.filter((m) => m.mapping !== null).slice(0, 4).map(async (m) => {
        const authenticated = await input.candleSource.authenticatedClient();
        try {
          const symbol = m.mapping!.alpacaSymbol;
          const [bars, quotes, books, currentAssetRaw, quote, book, product] = await Promise.all([
            input.candleSource.dailyBars(m.product.instrument, Math.max(200, policy.historyDays), input.clock.nowMs()),
            client.latestCryptoQuotes([symbol]), client.latestCryptoOrderbooks([symbol]), client.asset(symbol),
            authenticated ? fetchCoinbaseQuote(authenticated, m.product.instrument.productId, input.clock.nowMs()) : null,
            authenticated ? fetchCoinbaseBook(authenticated, m.product.instrument.productId, input.clock.nowMs()) : null,
            authenticated ? fetchCoinbaseProduct(authenticated, m.product.instrument.productId) : null,
          ]);
          const atMs = input.clock.nowMs();
          if (atMs >= slotMs + 900_000) return;
          const currentAsset = parseAlpacaUniverseAssets([currentAssetRaw])[0]!;
          const evidence: UniverseAssetEvidence = { product: m.product, asset: m.asset, mapping: m.mapping, mappingReason: m.reason,
            catalogObservedAtMs: catalog.observedAtMs, accountObservedAtMs: accountAtMs, accountReady,
            bars: bars.ok ? bars.bars : [], listedAtMs: null,
            currentAsset, currentProduct: product === null ? null : { ...m.product, ...product, minMarketFunds: product.quoteMinSize },
            rulesObservedAtMs: atMs,
            coinbase: quote && book ? { ...quote, quoteAtMs: quote.observedAtMs, bookAtMs: book.observedAtMs,
              capturedAtMs: atMs, bids: book.bids, asks: book.asks } : null,
            alpaca: parseAlpacaUniverseLiquidity(quotes, books, symbol, atMs) };
          append('observation', `${slotMs}:${instrumentKey(m.product.instrument)}`, atMs,
            { slotMs, catalogHash: prior.hash, atMs, evidence, evaluation: evaluateUniverseAsset(evidence, atMs, policy) });
        } catch {
          const atMs = input.clock.nowMs();
          if (atMs < slotMs + 900_000) {
            const evidence: UniverseAssetEvidence = { product: m.product, asset: m.asset, mapping: m.mapping,
              mappingReason: m.reason, catalogObservedAtMs: catalog.observedAtMs, accountObservedAtMs: accountAtMs,
              accountReady, bars: [], listedAtMs: null, currentProduct: null, currentAsset: null,
              rulesObservedAtMs: atMs, coinbase: null, alpaca: null };
            append('observation', `${slotMs}:${instrumentKey(m.product.instrument)}`, atMs,
              { slotMs, catalogHash: prior.hash, atMs, evidence, acquisitionReason: 'asset_acquisition_failed' });
          }
        } finally { authenticated?.destroy(); }
      }));
      let observations = records('observation').filter((r) => r.key.startsWith(`${slotMs}:`))
        .map((r) => r.body as UniverseObservation);
      if (observations.length !== mapped.length || records('shadow').some((r) => r.key === `${policyHash}:${slotMs}`)) return;
      // Reprice the completed cross-section together. Historical acquisition times never stand in for current liquidity.
      const symbols = mapped.flatMap((m) => m.mapping ? [m.mapping.alpacaSymbol] : []);
      if (symbols.length === 0 || symbols.length > 100) throw new Error('universe_symbol_batch_unavailable');
      const [freshAccount, positions, freshQuotes, freshBooks] = await Promise.all([
        client.account(), client.positions(), client.latestCryptoQuotes(symbols), client.latestCryptoOrderbooks(symbols) ]);
      const freshAccountAt = input.clock.nowMs();
      const updated = new Map<string, UniverseAssetEvidence>();
      const supported = observations.filter((o) => o.evidence.mapping !== null);
      for (let offset = 0; offset < supported.length; offset += 4) {
        await Promise.all(supported.slice(offset, offset + 4).map(async (o) => {
          const e = o.evidence, auth = await input.candleSource.authenticatedClient();
          try {
            const [q, b, p, a] = await Promise.all([
              auth ? fetchCoinbaseQuote(auth, e.product.instrument.productId, input.clock.nowMs()) : null,
              auth ? fetchCoinbaseBook(auth, e.product.instrument.productId, input.clock.nowMs()) : null,
              auth ? fetchCoinbaseProduct(auth, e.product.instrument.productId) : null,
              client.asset(e.mapping!.alpacaSymbol) ]);
            const captured = input.clock.nowMs();
            updated.set(instrumentKey(e.product.instrument), { ...e,
              currentAsset: parseAlpacaUniverseAssets([a])[0]!,
              currentProduct: p ? { ...e.product, ...p, minMarketFunds: p.quoteMinSize } : null,
              rulesObservedAtMs: captured,
              coinbase: q && b ? { bid: q.bid, ask: q.ask, quoteAtMs: q.observedAtMs,
                bookAtMs: b.observedAtMs, capturedAtMs: captured, bids: b.bids, asks: b.asks } : null,
              alpaca: parseAlpacaUniverseLiquidity(freshQuotes, freshBooks, e.mapping!.alpacaSymbol, freshAccountAt) });
          } catch {
            updated.set(instrumentKey(e.product.instrument), { ...e, currentProduct: null, currentAsset: null,
              rulesObservedAtMs: input.clock.nowMs(), coinbase: null, alpaca: null });
          } finally { auth?.destroy(); }
        }));
      }
      const frameAt = input.clock.nowMs();
      if (frameAt >= slotMs + 900_000) return;
      observations = observations.map((o) => ({ atMs: frameAt, evidence: {
        ...(updated.get(instrumentKey(o.evidence.product.instrument)) ?? o.evidence),
        accountObservedAtMs: freshAccountAt,
        accountReady: freshAccount.id === experiment.alpacaAccountId && ['ACTIVE', 'PAPER_ONLY'].includes(freshAccount.status) &&
          freshAccount.currency === 'USD' && !freshAccount.trading_blocked && !freshAccount.account_blocked } }));
      const slot = { slotMs, observations, catalogHash: prior.hash, catalogAssetIds: mapped.map((m) => instrumentKey(m.product.instrument)) };
      if (!records('frame').some((r) => r.key === String(slotMs))) append('frame', String(slotMs), frameAt, slot);
      let strategy: ReturnType<typeof universeStrategyInput>;
      try { strategy = universeStrategyInput(slot, experiment.anchor, policy); }
      catch {
        append('shadow', `${policyHash}:${slotMs}`, frameAt, { mode: 'shadow', executionEnabled: false,
          reason: 'strategy_history_incomplete', proposedTargets: null, baselineTargets: null,
          policyHash, datasetHash: universeHash(slot), catalogHash: prior.hash,
          evaluations: observations.map((o) => evaluateUniverseAsset(o.evidence, o.atMs, policy)) });
        return;
      }
      const quantities: Record<string, string> = {};
      let unmappedPosition = false;
      for (const position of positions) {
        const found = mapped.find((m) => m.mapping?.alpacaSymbol.replace('/', '') === position.symbol.replace('/', ''));
        if (!found) { unmappedPosition = true; continue; }
        quantities[instrumentKey(found.product.instrument)] = position.qty;
      }
      // This is a hypothetical account snapshot, not an order intent or reconciliation result.
      let planning: unknown;
      try {
        if (unmappedPosition) throw new Error('universe_unmapped_position');
        planning = planUniverseShadow(slot, strategy.proposedTargets, { cash: freshAccount.cash, quantities }, policy);
      } catch { planning = { status: 'blocked', reason: 'portfolio_or_execution_evidence_unavailable', applied: false }; }
      append('shadow', `${policyHash}:${slotMs}`, input.clock.nowMs(), { ...strategy, planning,
        accountSnapshotAtMs: freshAccountAt, functionalReadiness: 'not_attested', historicalQualification: 'collecting',
        executionEnabled: false });
    } catch {
      const atMs = input.clock.nowMs();
      const key = `collection:${Math.floor(atMs / 60_000)}`;
      try { if (!records('failure').some((r) => r.key === key)) append('failure', key, atMs,
        { reason: 'universe_collection_or_shadow_incomplete', executionEnabled: false }); }
      catch { input.onUnexpectedError('universe_persistence', new Error('universe_persistence_failed')); }
    } finally { busy = false; }
  } };
}
