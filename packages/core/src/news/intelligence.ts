import { classifyMarketEvent } from '../events/market-event.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';
import type { StoredNewsObservation } from './types.js';
import type { NewsAsset, NewsIntelligenceConfiguration, NewsInstrumentAnalysis,
  NewsObservationAnalysis, NewsRegistryEvidence, NewsResolution } from './intelligence-types.js';

/** Changes to aliases, vocabulary, clause splitting or qualification require a new version. */
export const NEWS_INTELLIGENCE_VERSION = 'news-intelligence-v1' as const;
export const NEWS_ASSET_NAMES: Readonly<Record<NewsAsset, string>> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };
export function newsEvidenceHash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}
const POSITIVE = /\b(?:approval|approved|adoption|upgrade|launch|launched|restored|gains?|rises?|surges?|growth)\b/iu;
const NEGATIVE = /\b(?:exploit|hack|breach|stolen|ban|lawsuit|outage|delisting|collapse|falls?|loss|loses?|declines?|drops?)\b/iu;
const NEGATION = /\b(?:no|not|never|without|denies?|denied)\b/iu;
const QUALIFIER = /\b(?:crypto|cryptocurrency|token|coin|blockchain)\b/iu;
function clauses(text: string): string[] { return text.split(/[.!?;\n]+|\b(?:but|while|whereas)\b/iu).map(s => s.trim()).filter(Boolean); }
function hasWord(text: string, word: string): boolean { return new RegExp(`\\b${word}\\b`, 'iu').test(text); }
function named(text: string, asset: NewsAsset): boolean {
  const excluded = asset === 'BTC' ? /\b(?:wrapped bitcoin|bitcoin (?:cash|sv|gold))\b/giu :
    asset === 'ETH' ? /\bethereum classic\b/giu : null;
  return hasWord(excluded ? text.replace(excluded, '') : text, NEWS_ASSET_NAMES[asset]);
}
function quoted(text: string, word: string): boolean {
  return new RegExp(`\\b(?:quoted|priced|denominated)\\s+in\\s+${word}\\b`, 'iu').test(text);
}
function qualified(text: string, asset: NewsAsset): boolean {
  const words = text.split(/\s+/u);
  return words.some((word, i) => hasWord(word, asset) && QUALIFIER.test(words.slice(Math.max(0, i - 3), i + 4).join(' ')));
}
export function normalizedNewsPublisher(host: string, configuration: NewsIntelligenceConfiguration): string {
  const normalized = host.toLowerCase().replace(/\.$/u, '');
  return configuration.publisherAliases.find(alias => alias.from === normalized)?.to ?? normalized;
}

/** Resolves reviewed names and qualified symbols, never a ticker-only join. */
export function analyzeNewsObservation(stored: StoredNewsObservation, configuration: NewsIntelligenceConfiguration,
  registry: readonly NewsRegistryEvidence[], firstAvailableAtMs = stored.availableAtMs): NewsObservationAnalysis {
  const observation = stored.observation, text = `${observation.title}. ${observation.description ?? ''}`;
  const pieces = clauses(text), resolutions: NewsResolution[] = [];
  const resolve = (candidate: string, origin: 'text' | 'provider', entityIndex: number | null,
    asset: NewsAsset | null, reason: NewsResolution['reason'], allowed: boolean): void => {
    const mapping = registry.find(entry => entry.asset === asset);
    const quote = (mapping && candidate.toUpperCase() === mapping.quoteAsset.toUpperCase()) ||
      (asset === null && registry.some(r => r.quoteAsset.toUpperCase() === candidate.toUpperCase()));
    resolutions.push({ candidate, origin, entityIndex, asset, instrument: allowed && mapping && !quote ? mapping.instrument : null,
      status: allowed && mapping && !quote ? 'resolved' : 'unresolved',
      reason: quote ? 'quote_currency' : allowed && !mapping ? 'missing_registry' : reason });
  };
  for (const asset of ['BTC', 'ETH', 'SOL'] as const) {
    if (hasWord(text, NEWS_ASSET_NAMES[asset])) {
      const allowed = pieces.some(piece => named(piece, asset) && !quoted(piece, NEWS_ASSET_NAMES[asset]));
      resolve(NEWS_ASSET_NAMES[asset], 'text', null, asset, allowed ? 'explicit_name' :
        named(text, asset) ? 'quote_currency' : 'unsupported', allowed);
    }
    if (hasWord(text, asset)) {
      const allowed = pieces.some(piece => qualified(piece, asset) && !quoted(piece, asset));
      resolve(asset, 'text', null, asset, allowed ? 'crypto_qualified' : 'ambiguous_ticker', allowed);
    }
  }
  observation.entities.forEach((entity, index) => {
    const asset = (['BTC', 'ETH', 'SOL'] as const).find(a => a === entity.symbol.toUpperCase() ||
      NEWS_ASSET_NAMES[a].toLowerCase() === entity.symbol.toLowerCase()) ?? null;
    const explicit = asset !== null && hasWord(entity.symbol, NEWS_ASSET_NAMES[asset]);
    const allowed = entity.assetClass !== 'equity' && asset !== null && (entity.assetClass === 'crypto' || explicit);
    resolve(entity.symbol, 'provider', index, asset, entity.assetClass === 'equity' ? 'equity' : asset === null ? 'unsupported' :
      entity.assetClass === 'crypto' ? 'provider_crypto' : explicit ? 'explicit_name' : 'ambiguous_ticker', allowed);
  });
  const instruments: NewsInstrumentAnalysis[] = [];
  for (const entry of registry) {
    if (!resolutions.some(r => r.status === 'resolved' && r.asset === entry.asset)) continue;
    const providerCrypto = resolutions.some(r => r.origin === 'provider' && r.status === 'resolved' && r.asset === entry.asset && r.reason === 'provider_crypto');
    const relevant = pieces.filter(piece => (named(piece, entry.asset) && !quoted(piece, NEWS_ASSET_NAMES[entry.asset])) || qualified(piece, entry.asset) ||
      (providerCrypto && hasWord(piece, entry.asset)));
    // A clause mentioning another asset cannot allocate its tone safely to either instrument.
    const unambiguous = relevant.filter(piece => !(['BTC', 'ETH', 'SOL'] as const).some(other => other !== entry.asset &&
      (hasWord(piece, NEWS_ASSET_NAMES[other]) || hasWord(piece, other))));
    const unsupported = observation.language === null || !/^(?:en(?:[-_].*)?|english)$/iu.test(observation.language);
    const positive = unambiguous.some(piece => POSITIVE.test(piece) && !NEGATION.test(piece));
    const negative = unambiguous.some(piece => NEGATIVE.test(piece) && !NEGATION.test(piece));
    const uncertain = relevant.length !== unambiguous.length || unambiguous.some(piece => NEGATION.test(piece));
    const reason = unsupported ? 'unsupported_language' : positive && negative ? 'conflicting' :
      uncertain ? 'insufficient' : positive ? 'positive' : negative ? 'negative' : 'insufficient';
    instruments.push({ asset: entry.asset, instrument: entry.instrument,
      sentimentScore: reason === 'positive' ? 1 : reason === 'negative' ? -1 : null,
      sentimentReason: reason, clauses: relevant,
      providerEntities: resolutions.filter(r => r.origin === 'provider' && r.status === 'resolved' && r.asset === entry.asset)
        .map(r => ({ index: r.entityIndex!, entity: observation.entities[r.entityIndex!]! })) });
  }
  return { schemaVersion: 1, observationId: stored.observationId, providerRecordId: stored.providerRecordId, observedAtMs: observation.observedAtMs, articleId: stored.articleId,
    provider: observation.provider, availableAtMs: stored.availableAtMs, firstAvailableAtMs,
    publisher: normalizedNewsPublisher(observation.sourceDomain, configuration), title: observation.title,
    description: observation.description, eventLabel: classifyMarketEvent({ title: observation.title,
      summary: observation.description ?? '' }, stored.availableAtMs).label, resolutions, instruments };
}
