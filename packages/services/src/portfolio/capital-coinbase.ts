import { Decimal } from 'decimal.js';
import type { CoinbaseEvidenceAcquisition, CoinbaseCapitalTransactionMetadata } from '@coqui/adapters';
import { capitalHash, coinbaseEvidenceDatasetHash, sha256Hex, type CanonicalJsonValue, type CapitalValuation, type ConnectionAccountSnapshotV2 } from '@coqui/core';
import { listVerifiedWalletIdentities, type Db } from '@coqui/storage';

import { ingestCapitalEvidence } from './capital-accounting.js';
import { capitalSourceBatch, capitalSourceEvent, capitalSourceScope } from './capital-sources.js';

export function ingestCoinbaseCapital(input: {
  readonly profileId: string; readonly connectionId: string; readonly requestedAtMs: number; readonly observedAtMs: number;
  readonly acquisition: CoinbaseEvidenceAcquisition; readonly snapshot: ConnectionAccountSnapshotV2 | null;
}, database: Db): void {
  const identity = listVerifiedWalletIdentities(input.profileId, database).find((row) => row.connection_id === input.connectionId &&
    row.provider === 'coinbase' && row.identity_kind === 'portfolio');
  if (!identity) return; // A credential fingerprint is not a financial account identity.
  const { acquisition: acquired } = input;
  if (input.snapshot !== null && (input.snapshot.profileId !== input.profileId || input.snapshot.connectionId !== input.connectionId ||
    input.snapshot.provider !== 'coinbase')) throw new TypeError('Capital Coinbase snapshot scope mismatch.');
  if (coinbaseEvidenceDatasetHash(acquired.accounts, acquired.fills, acquired.transactions, acquired.feeTier) !== acquired.datasetHash) {
    throw new TypeError('Capital Coinbase dataset hash mismatch.');
  }
  const scope = capitalSourceScope(input.profileId, 'coinbase', 'production_read_only', identity.identity_hash, input.observedAtMs);
  const envelope = acquired.capitalEvidence;
  const members = acquired.accounts.map((account) => sha256Hex(account.accountUuid.toLowerCase()));
  const memberSet = new Set(members);
  if (acquired.transactions.some((tx) => !memberSet.has(sha256Hex(tx.accountUuid.toLowerCase())))) throw new TypeError('Capital Coinbase transaction scope mismatch.');
  const accountMetadata = new Map<string, Array<{ portfolioIdentityHash: string | null }>>();
  for (const row of envelope?.accounts ?? []) {
    const group = accountMetadata.get(row.accountUuid) ?? []; group.push(row); accountMetadata.set(row.accountUuid, group);
    if (row.portfolioIdentityHash !== null && row.portfolioIdentityHash !== identity.identity_hash) throw new TypeError('Capital Coinbase portfolio identity mismatch.');
  }
  const transactionMetadata = new Map<string, CoinbaseCapitalTransactionMetadata[]>();
  for (const row of envelope?.transactions ?? []) {
    const key = `${row.accountUuid}:${row.transactionId}`, group = transactionMetadata.get(key) ?? [];
    group.push(row); transactionMetadata.set(key, group);
  }
  const fillEntries = new Set(acquired.fills.map((row) => row.entryId).filter((id) => id != null));
  const fillTrades = new Set(acquired.fills.map((row) => row.tradeId)), fillOrders = new Set(acquired.fills.map((row) => row.orderId));
  const transferGroups = new Map<string, typeof acquired.transactions[number][]>();
  for (const tx of acquired.transactions) if (tx.type === 'transfer' && tx.status === 'completed') {
    const key = `${sha256Hex(tx.accountUuid.toLowerCase())}:${tx.amountCurrency}:${new Decimal(tx.amount).toFixed()}`;
    const group = transferGroups.get(key) ?? []; group.push(tx); transferGroups.set(key, group);
  }
  const membershipComplete = envelope !== undefined && acquired.accounts.every((account) => {
    const metadata = accountMetadata.get(account.accountUuid) ?? [];
    return metadata.length > 0 && metadata.every((row) => row.portfolioIdentityHash === identity.identity_hash);
  });
  const batch = capitalSourceBatch({ scopeId: scope.id, source: 'coinbase-capital-envelope-v1', requestedAtMs: input.requestedAtMs,
    observedAtMs: input.observedAtMs, recordedAtMs: input.observedAtMs,
    coverage: { fromMs: null, toMs: input.observedAtMs, complete: false,
      paginationComplete: envelope?.paginationComplete ?? false, membershipComplete,
      reasonCodes: ['financial_history_interval_unverified', 'coherent_financial_cut_unverified',
        ...(!membershipComplete ? ['portfolio_membership_unverified'] : [])] },
    memberIdentityHashes: members, evidenceRefs: [acquired.datasetHash, identity.id, ...(input.snapshot ? [input.snapshot.contentHash] : [])],
    payload: { schemaVersion: 1, legacyDatasetHash: acquired.datasetHash,
      accountMembership: (envelope?.accounts ?? []).map((row) => ({ accountIdentityHash: sha256Hex(row.accountUuid.toLowerCase()), portfolioIdentityHash: row.portfolioIdentityHash })),
      transactionMetadata: (envelope?.transactions ?? []).map((row) => ({ accountIdentityHash: sha256Hex(row.accountUuid.toLowerCase()),
        transactionId: row.transactionId, counterpartyAccountHash: row.counterpartyAccountHash, counterpartyKind: row.counterpartyKind,
        fee: row.fee === null ? null : { asset: row.fee.asset, quantity: row.fee.quantity },
        fillEntryId: row.fillEntryId, orderId: row.orderId, tradeId: row.tradeId })),
      legacyDataset: JSON.parse(JSON.stringify({
        accounts: acquired.accounts.map((row) => ({ accountUuid: row.accountUuid, currency: row.currency, availableQuantity: row.availableQuantity,
          holdQuantity: row.holdQuantity, totalQuantity: row.totalQuantity, active: row.active, ready: row.ready,
          defaultAccount: row.defaultAccount, providerUpdatedAtMs: row.providerUpdatedAtMs })),
        fills: acquired.fills.map((row) => ({ entryId: row.entryId ?? null, tradeId: row.tradeId, orderId: row.orderId,
          productId: row.productId, side: row.side, price: row.price, size: row.size, commission: row.commission,
          commissionDetail: row.commissionDetail ?? null, sizeInQuote: row.sizeInQuote, tradeAtMs: row.tradeAtMs, sequenceAtMs: row.sequenceAtMs })),
        transactions: acquired.transactions.map((row) => ({ transactionId: row.transactionId, accountUuid: row.accountUuid,
          type: row.type, status: row.status, amount: row.amount, amountCurrency: row.amountCurrency, nativeAmount: row.nativeAmount,
          nativeCurrency: row.nativeCurrency, createdAtMs: row.createdAtMs, updatedAtMs: row.updatedAtMs, resourcePath: row.resourcePath })),
        feeTier: acquired.feeTier === null ? null : { pricingTier: acquired.feeTier.pricingTier, makerFeeRate: acquired.feeTier.makerFeeRate,
          takerFeeRate: acquired.feeTier.takerFeeRate, usdFrom: acquired.feeTier.usdFrom, usdTo: acquired.feeTier.usdTo },
      })) as CanonicalJsonValue,
      accountPageCount: acquired.accountPageCount, fillPageCount: acquired.fillPageCount, transactionPageCount: acquired.transactionPageCount,
      limits: { accounts: 10_000, fills: 100_000, transactions: 100_000, pages: 1_000, elapsedMs: 300_000 } },
  });
  const events = acquired.fills.map((fill) => {
    const usdFee = fill.productId.endsWith('-USD') ? fill.commission : null;
    const asset = fill.sizeInQuote ? fill.productId.split('-').at(-1)! : fill.productId.slice(0, fill.productId.lastIndexOf('-'));
    const signedSize = new Decimal(fill.size).mul((fill.side === 'SELL') !== fill.sizeInQuote ? -1 : 1).toFixed();
    return capitalSourceEvent(batch, { logicalKey: `coinbase-fill:${fill.orderId}:${fill.tradeId}`, kind: 'trade', status: 'confirmed',
      effectiveTime: { precision: 'instant', fromMs: fill.tradeAtMs, toMs: fill.tradeAtMs }, externalFlowUsd: '0',
      flowVerified: membershipComplete, feeUsd: usdFee, reasonCodes: membershipComplete ? [] : ['portfolio_membership_unverified'],
      legs: [{ asset, quantity: signedSize, role: asset === 'USD' ? 'cash' : 'asset',
        valueUsd: asset === 'USD' ? signedSize : null, valuationRef: fill.tradeId }] });
  });
  for (const tx of acquired.transactions) {
    const metadataRows = transactionMetadata.get(`${tx.accountUuid}:${tx.transactionId}`) ?? [];
    const metadata = metadataRows[0];
    const metadataConsistent = metadata !== undefined && metadataRows.every((row) => capitalHash(row) === capitalHash(metadata));
    const completed = tx.status === 'completed';
    const status = completed ? 'confirmed' as const : ['failed', 'canceled', 'expired'].includes(tx.status) ? 'failed' as const : 'pending' as const;
    const link = metadataConsistent && (metadata.fillEntryId !== null && fillEntries.has(metadata.fillEntryId) ||
      metadata.tradeId !== null && fillTrades.has(metadata.tradeId) || metadata.orderId !== null && fillOrders.has(metadata.orderId));
    const internal = tx.type === 'advanced_trade_fill' && link;
    const fiat = ['fiat_deposit', 'fiat_withdrawal'].includes(tx.type) && tx.amountCurrency === 'USD';
    const transferInternal = tx.type === 'transfer' && metadataConsistent && metadata.counterpartyKind === 'account' &&
      metadata.counterpartyAccountHash !== null && memberSet.has(metadata.counterpartyAccountHash) &&
      (transferGroups.get(`${metadata.counterpartyAccountHash}:${tx.amountCurrency}:${new Decimal(tx.amount).neg().toFixed()}`) ?? []).some((other) =>
        (transactionMetadata.get(`${other.accountUuid}:${other.transactionId}`) ?? []).some((peer) =>
          peer.counterpartyAccountHash === sha256Hex(tx.accountUuid.toLowerCase())));
    // Created/updated timestamps and native_amount remain raw provenance, never financial effect/arrival marks.
    const verifiedInternal = completed && membershipComplete && internal;
    events.push(capitalSourceEvent(batch, { logicalKey: `coinbase-transaction:${tx.accountUuid}:${tx.transactionId}`,
      kind: internal ? 'trade' : transferInternal ? 'internal_transfer' : fiat ? tx.type === 'fiat_deposit' ? 'contribution' : 'outflow' : 'unknown', status,
      externalFlowUsd: verifiedInternal ? '0' : fiat ? tx.amount : null, flowVerified: verifiedInternal,
      feeUsd: internal ? '0' : metadata?.fee?.asset === 'USD' ? metadata.fee.quantity : null,
      reasonCodes: verifiedInternal ? [] : ['financial_effective_time_unverified', ...(!metadataConsistent ? ['transaction_metadata_unverified'] : [])],
      legs: [{ asset: tx.amountCurrency, quantity: tx.amount, role: tx.amountCurrency === 'USD' ? 'cash' : 'asset',
        valueUsd: tx.amountCurrency === 'USD' ? tx.amount : null, valuationRef: tx.resourcePath },
      ...(metadata?.fee ? [{ asset: metadata.fee.asset, quantity: metadata.fee.quantity, role: 'fee' as const,
        valueUsd: metadata.fee.asset === 'USD' ? metadata.fee.quantity : null, valuationRef: tx.resourcePath }] : [])] }));
  }
  const valuations: CapitalValuation[] = [];
  if (input.snapshot !== null) {
    const seen = new Map<string, Decimal>();
    for (const balance of input.snapshot.balances) seen.set(balance.exposureKey, new Decimal(seen.get(balance.exposureKey) ?? 0).add(balance.totalQuantity));
    const expected = new Map<string, Decimal>();
    for (const row of acquired.accounts) expected.set(row.currency, new Decimal(expected.get(row.currency) ?? 0).add(row.totalQuantity));
    const allBalancesPresent = [...new Set([...expected.keys(), ...seen.keys()])].every((currency) =>
      new Decimal(expected.get(currency) ?? 0).eq(seen.get(currency) ?? 0));
    const equity = input.snapshot.complete && allBalancesPresent && membershipComplete ? input.snapshot.balances.reduce((sum, row) => sum.add(row.valueUsd ?? 0), new Decimal(0)).toFixed() : null;
    valuations.push({ id: capitalHash({ scopeId: scope.id, snapshotHash: input.snapshot.contentHash }), scopeId: scope.id,
      sourceBatchId: batch.id, replacesId: null, atMs: input.snapshot.asOfMs, sequence: 0, observedAtMs: input.observedAtMs,
      equityUsd: equity, cashUsd: input.snapshot.cashUsd,
      legs: input.snapshot.balances.map((row) => ({ asset: row.exposureKey, quantity: row.totalQuantity,
        role: row.exposureKey === 'USD' ? 'cash' as const : 'asset' as const, valueUsd: row.valueUsd, valuationRef: input.snapshot!.contentHash })),
      verified: false, missingComponents: ['coherent_financial_cut_unverified', ...(!membershipComplete ? ['portfolio_membership_unverified'] : []),
        ...(!allBalancesPresent ? ['account_balances_incomplete'] : [])], evidenceRefs: [input.snapshot.contentHash] });
  }
  ingestCapitalEvidence({ profileId: input.profileId, connectionId: input.connectionId, scope, batch, events, valuations, opening: null }, database);
}
