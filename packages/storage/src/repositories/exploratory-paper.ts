import { Decimal } from 'decimal.js';

import {
  canonicalJson,
  exploratoryCampaignHash,
  exploratoryValuationHash,
  sha256Hex,
  type CanonicalJsonValue,
  type ExploratoryCampaignStatus,
  type ExploratoryPaperBalanceV1,
  type ExploratoryPaperCampaignV1,
  type ExploratoryPaperValuationV1,
  type PaperFill,
  type PaperLedgerEntry,
  type PaperPendingExecutionV1,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

function json(value: unknown): string {
  return canonicalJson(value as CanonicalJsonValue);
}

function campaignFromJson(value: string): ExploratoryPaperCampaignV1 {
  const campaign = JSON.parse(value) as ExploratoryPaperCampaignV1;
  const { contentHash: _contentHash, ...material } = campaign;
  void _contentHash;
  if (exploratoryCampaignHash(material) !== campaign.contentHash) {
    throw new Error('Exploratory campaign integrity failed.');
  }
  return Object.freeze(campaign);
}

export function saveExploratoryPaperCampaign(
  campaign: ExploratoryPaperCampaignV1,
  database: Db,
): 'created' | 'exists' {
  const { contentHash: _contentHash, ...material } = campaign;
  void _contentHash;
  if (exploratoryCampaignHash(material) !== campaign.contentHash) {
    throw new TypeError('Invalid exploratory campaign hash.');
  }
  return inTransaction(database, () => {
    const prior = getExploratoryPaperCampaignByCommand(campaign.profileId, campaign.commandId, database);
    if (prior !== null) {
      if (prior.contentHash !== campaign.contentHash) {
        throw new Error('Exploratory start command cannot change.');
      }
      return 'exists';
    }
    const occupied = database.prepare(`SELECT campaign_id FROM exploratory_paper_campaign_state_v1
      WHERE profile_id=? AND status<>'stopped'`).get(campaign.profileId) as { campaign_id: string } | undefined;
    if (occupied !== undefined) throw new Error('An exploratory campaign is already active.');
    database.prepare(`INSERT INTO exploratory_paper_campaigns_v1
      (campaign_id,profile_id,command_id,source_portfolio_snapshot_id,started_at,content_json,content_hash)
      VALUES(?,?,?,?,?,?,?)`).run(campaign.campaignId, campaign.profileId, campaign.commandId,
      campaign.sourcePortfolioSnapshotId, campaign.startedAtMs, json(campaign), campaign.contentHash);
    database.prepare(`INSERT INTO exploratory_paper_campaign_state_v1
      (profile_id,campaign_id,status,revision,updated_at) VALUES(?,?,'active',0,?)
      ON CONFLICT(profile_id) DO UPDATE SET campaign_id=excluded.campaign_id,status='active',revision=0,updated_at=excluded.updated_at
      WHERE exploratory_paper_campaign_state_v1.status='stopped'`)
      .run(campaign.profileId, campaign.campaignId, campaign.startedAtMs);
    database.prepare(`INSERT INTO exploratory_paper_campaign_events_v1
      (id,campaign_id,profile_id,command_id,sequence,kind,at,detail_json)
      VALUES(?,?,?,?,0,'started',?,'{}')`).run(
      sha256Hex(`${campaign.campaignId}:0:started`), campaign.campaignId, campaign.profileId,
      campaign.commandId, campaign.startedAtMs,
    );
    const balance = database.prepare(`INSERT INTO exploratory_paper_balances_v1
      (campaign_id,profile_id,exposure_key,asset_id,quantity_text,managed,updated_at)
      VALUES(?,?,?,?,?,?,?)`);
    const ledger = database.prepare(`INSERT INTO exploratory_paper_ledger_entries_v1
      (id,campaign_id,profile_id,run_id,order_id,fill_id,account,exposure_key,asset_id,
       amount_usd_text,quantity_text,at,detail_json) VALUES(?,?,?,?,NULL,NULL,'opening',?,?, '0',?,?,'{}')`);
    balance.run(campaign.campaignId, campaign.profileId, 'USD', null,
      campaign.openingCashUsd, 0, campaign.startedAtMs);
    ledger.run(sha256Hex(`${campaign.campaignId}:opening:USD`), campaign.campaignId,
      campaign.profileId, `exploratory-origin:${campaign.contentHash}`, 'USD', null,
      campaign.openingCashUsd, campaign.startedAtMs);
    for (const opening of campaign.openingBalances) {
      balance.run(campaign.campaignId, campaign.profileId, opening.exposureKey, opening.assetId,
        opening.quantity, Number(opening.managed), campaign.startedAtMs);
      ledger.run(sha256Hex(`${campaign.campaignId}:opening:${opening.exposureKey}`),
        campaign.campaignId, campaign.profileId, `exploratory-origin:${campaign.contentHash}`,
        opening.exposureKey, opening.assetId, opening.quantity, campaign.startedAtMs);
    }
    return 'created';
  });
}

export function getExploratoryPaperCampaignByCommand(
  profileId: string,
  commandId: string,
  database: Db,
): ExploratoryPaperCampaignV1 | null {
  const row = database.prepare(`SELECT content_json FROM exploratory_paper_campaigns_v1
    WHERE profile_id=? AND command_id=?`).get(profileId, commandId) as { content_json: string } | undefined;
  return row === undefined ? null : campaignFromJson(row.content_json);
}

export function getExploratoryPaperCampaign(
  campaignId: string,
  profileId: string,
  database: Db,
): ExploratoryPaperCampaignV1 | null {
  const row = database.prepare(`SELECT content_json FROM exploratory_paper_campaigns_v1
    WHERE campaign_id=? AND profile_id=?`).get(campaignId, profileId) as { content_json: string } | undefined;
  return row === undefined ? null : campaignFromJson(row.content_json);
}

export function currentExploratoryPaperCampaign(profileId: string, database: Db): Readonly<{
  campaign: ExploratoryPaperCampaignV1;
  status: ExploratoryCampaignStatus;
  revision: number;
  updatedAtMs: number;
}> | null {
  const row = database.prepare(`SELECT campaign_id,status,revision,updated_at
    FROM exploratory_paper_campaign_state_v1 WHERE profile_id=?`).get(profileId) as {
      campaign_id: string; status: ExploratoryCampaignStatus; revision: number; updated_at: number;
    } | undefined;
  if (row === undefined) return null;
  const campaign = getExploratoryPaperCampaign(row.campaign_id, profileId, database);
  if (campaign === null) throw new Error('Exploratory campaign state is orphaned.');
  return Object.freeze({ campaign, status: row.status, revision: row.revision, updatedAtMs: row.updated_at });
}

const TRANSITIONS: Readonly<Record<ExploratoryCampaignStatus, readonly ExploratoryCampaignStatus[]>> = {
  active: ['paused', 'stopping'], paused: ['active', 'stopping'], stopping: ['stopped'], stopped: [],
};

export function transitionExploratoryPaperCampaign(input: {
  readonly profileId: string;
  readonly campaignId: string;
  readonly commandId: string;
  readonly status: ExploratoryCampaignStatus;
  readonly atMs: number;
}, database: Db): ReturnType<typeof currentExploratoryPaperCampaign> {
  return inTransaction(database, () => {
    const duplicate = database.prepare(`SELECT campaign_id,kind FROM exploratory_paper_campaign_events_v1
      WHERE profile_id=? AND command_id=?`).get(input.profileId, input.commandId) as
      { campaign_id: string; kind: string } | undefined;
    if (duplicate !== undefined) {
      const expectedKind = input.status === 'active' ? 'resumed' : input.status;
      if (duplicate.campaign_id !== input.campaignId || duplicate.kind !== expectedKind) {
        throw new Error('Exploratory campaign command cannot change.');
      }
      return currentExploratoryPaperCampaign(input.profileId, database);
    }
    const current = currentExploratoryPaperCampaign(input.profileId, database);
    if (current === null || current.campaign.campaignId !== input.campaignId) {
      throw new Error('Exploratory campaign not found.');
    }
    if (!TRANSITIONS[current.status].includes(input.status)) {
      throw new Error(`Invalid exploratory campaign transition: ${current.status} -> ${input.status}.`);
    }
    const sequence = current.revision + 1;
    database.prepare(`INSERT INTO exploratory_paper_campaign_events_v1
      (id,campaign_id,profile_id,command_id,sequence,kind,at,detail_json)
      VALUES(?,?,?,?,?,?,?,'{}')`).run(
      sha256Hex(`${input.campaignId}:${sequence}:${input.status}`), input.campaignId,
      input.profileId, input.commandId, sequence,
      input.status === 'active' ? 'resumed' : input.status, input.atMs,
    );
    database.prepare(`UPDATE exploratory_paper_campaign_state_v1
      SET status=?,revision=?,updated_at=? WHERE profile_id=? AND campaign_id=?`)
      .run(input.status, sequence, input.atMs, input.profileId, input.campaignId);
    return currentExploratoryPaperCampaign(input.profileId, database);
  });
}

export function listExploratoryPaperBalances(
  campaignId: string,
  profileId: string,
  database: Db,
): readonly ExploratoryPaperBalanceV1[] {
  const rows = database.prepare(`SELECT campaign_id,exposure_key,asset_id,quantity_text,managed,updated_at
    FROM exploratory_paper_balances_v1 WHERE campaign_id=? AND profile_id=? ORDER BY exposure_key`)
    .all(campaignId, profileId) as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => Object.freeze({
    campaignId: String(row['campaign_id']),
    exposureKey: String(row['exposure_key']) as ExploratoryPaperBalanceV1['exposureKey'],
    assetId: row['asset_id'] === null ? null : String(row['asset_id']),
    quantity: String(row['quantity_text']), managed: Number(row['managed']) === 1,
    updatedAtMs: Number(row['updated_at']),
  })));
}

export function linkExploratoryPaperExecution(input: {
  readonly campaignId: string;
  readonly profileId: string;
  readonly decisionId?: string;
  readonly proposalId?: string;
  readonly orderId?: string;
  readonly pendingId?: string;
  readonly fillId?: string;
  readonly createdAtMs: number;
}, database: Db): void {
  const material = { ...input };
  const contentHash = sha256Hex(json(material));
  database.prepare(`INSERT OR IGNORE INTO exploratory_paper_execution_links_v1
    (id,campaign_id,profile_id,decision_id,proposal_id,order_id,pending_id,fill_id,created_at,content_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(contentHash, input.campaignId, input.profileId,
    input.decisionId ?? null, input.proposalId ?? null, input.orderId ?? null,
    input.pendingId ?? null, input.fillId ?? null, input.createdAtMs, contentHash);
}

export function listSubmittedExploratoryPaperExecutions(
  campaignId: string,
  profileId: string,
  database: Db,
): readonly PaperPendingExecutionV1[] {
  const rows = database.prepare(`SELECT pending.content_json,pending.content_hash
    FROM paper_pending_executions_v1 pending
    JOIN exploratory_paper_execution_links_v1 link ON link.pending_id=pending.id
    WHERE link.campaign_id=? AND link.profile_id=? AND pending.profile_id=? AND pending.status='submitted'
    ORDER BY pending.required_bar_start,pending.id`).all(campaignId, profileId, profileId) as
    Array<{ content_json: string; content_hash: string }>;
  return Object.freeze(rows.map((row) => {
    if (sha256Hex(row.content_json) !== row.content_hash) throw new Error('Pending execution integrity failed.');
    return Object.freeze(JSON.parse(row.content_json) as PaperPendingExecutionV1);
  }));
}

export function countSubmittedExploratoryPaperExecutions(
  campaignId: string,
  profileId: string,
  database: Db,
): number {
  const row = database.prepare(`SELECT COUNT(DISTINCT pending.id) AS count
    FROM paper_pending_executions_v1 pending
    JOIN exploratory_paper_execution_links_v1 link ON link.pending_id=pending.id
    WHERE link.campaign_id=? AND link.profile_id=? AND pending.profile_id=? AND pending.status='submitted'`)
    .get(campaignId, profileId, profileId) as { count: number };
  return Number(row.count);
}

function assertExploratoryLedger(entries: readonly PaperLedgerEntry[]): void {
  let total = new Decimal(0);
  for (const entry of entries) {
    const amount = new Decimal(entry.amountUsd);
    const quantity = new Decimal(entry.quantity);
    if (!amount.isFinite() || !quantity.isFinite()) throw new TypeError('Invalid exploratory ledger decimal.');
    total = total.add(amount);
  }
  if (!total.isZero()) throw new Error('Exploratory paper fill ledger entries are not balanced.');
}

function assertExploratoryFillDecimals(fill: PaperFill): void {
  for (const value of [fill.quantity, fill.executionPrice, fill.notional, fill.venueFee,
    fill.spreadCost, fill.slippageCost, fill.impactCost]) {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative()) throw new TypeError('Invalid exploratory fill decimal.');
  }
}

export function commitExploratoryPaperFill(
  campaignId: string,
  fill: PaperFill,
  runId: string,
  entries: readonly PaperLedgerEntry[],
  database: Db,
): boolean {
  assertExploratoryFillDecimals(fill);
  assertExploratoryLedger(entries);
  return inTransaction(database, () => {
    const campaign = getExploratoryPaperCampaign(campaignId, fill.profileId, database);
    if (campaign === null) throw new Error('Exploratory campaign ownership mismatch.');
    const order = database.prepare(`SELECT profile_id,canonical_asset_id,state FROM paper_orders_v3
      WHERE id=?`).get(fill.orderId) as { profile_id: string; canonical_asset_id: string; state: string } | undefined;
    if (order === undefined || order.profile_id !== fill.profileId) {
      throw new Error('Exploratory fill profile does not match its order.');
    }
    if (!['submitted', 'acknowledged', 'open', 'partially_filled'].includes(order.state)) {
      throw new Error(`Exploratory paper order state ${order.state} cannot accept a fill.`);
    }
    for (const entry of entries) {
      if (entry.account === 'asset' && entry.instrument !== order.canonical_asset_id) {
        throw new Error('Exploratory asset posting does not match its order instrument.');
      }
      if (entry.account !== 'asset' && entry.instrument !== null) {
        throw new Error('Only exploratory asset postings may identify an instrument.');
      }
    }
    const duplicate = database.prepare(`SELECT order_id,profile_id,quantity_text,execution_price_text,
      notional_text,venue_fee_text,spread_cost_text,slippage_cost_text,impact_cost_text,
      filled_at,market_snapshot_hash FROM paper_fills_v3 WHERE id=?`).get(fill.id) as
      Record<string, unknown> | undefined;
    if (duplicate !== undefined) {
      const same = duplicate['order_id'] === fill.orderId && duplicate['profile_id'] === fill.profileId
        && duplicate['quantity_text'] === fill.quantity
        && duplicate['execution_price_text'] === fill.executionPrice
        && duplicate['notional_text'] === fill.notional && duplicate['venue_fee_text'] === fill.venueFee
        && duplicate['spread_cost_text'] === fill.spreadCost
        && duplicate['slippage_cost_text'] === fill.slippageCost
        && duplicate['impact_cost_text'] === fill.impactCost && duplicate['filled_at'] === fill.filledAt
        && duplicate['market_snapshot_hash'] === fill.marketSnapshotHash;
      if (!same) throw new Error('An exploratory paper fill identity cannot change after persistence.');
      return false;
    }
    database.prepare(`INSERT INTO paper_fills_v3
      (id,order_id,profile_id,quantity_text,execution_price_text,notional_text,venue_fee_text,
       spread_cost_text,slippage_cost_text,impact_cost_text,filled_at,market_snapshot_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(fill.id, fill.orderId, fill.profileId, fill.quantity,
      fill.executionPrice, fill.notional, fill.venueFee, fill.spreadCost, fill.slippageCost,
      fill.impactCost, fill.filledAt, fill.marketSnapshotHash);
    const current = database.prepare(`SELECT quantity_text FROM exploratory_paper_balances_v1
      WHERE campaign_id=? AND profile_id=? AND exposure_key=?`);
    const update = database.prepare(`UPDATE exploratory_paper_balances_v1 SET quantity_text=?,updated_at=?
      WHERE campaign_id=? AND profile_id=? AND exposure_key=?`);
    for (const [index, entry] of entries.entries()) {
      const exposureKey = entry.account === 'cash' ? 'USD'
        : entry.account === 'asset' ? entry.instrument?.split('|').at(-1)?.replace(/-USD$/u, '') ?? null : null;
      database.prepare(`INSERT INTO exploratory_paper_ledger_entries_v1
        (id,campaign_id,profile_id,run_id,order_id,fill_id,account,exposure_key,asset_id,
         amount_usd_text,quantity_text,at,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        sha256Hex(`${campaignId}:${fill.id}:ledger:${index}`), campaignId, fill.profileId, runId,
        fill.orderId, fill.id, entry.account, exposureKey, entry.instrument,
        entry.amountUsd, entry.quantity, fill.filledAt, '{}',
      );
      if (exposureKey === null || entry.account === 'venue_fee') continue;
      const row = current.get(campaignId, fill.profileId, exposureKey) as { quantity_text: string } | undefined;
      if (row === undefined) throw new Error(`Exploratory balance ${exposureKey} is missing.`);
      const delta = entry.account === 'cash' ? new Decimal(entry.amountUsd) : new Decimal(entry.quantity);
      const next = new Decimal(row.quantity_text).add(delta);
      if (next.isNegative()) throw new Error(`Exploratory fill would make ${exposureKey} negative.`);
      update.run(next.toFixed(), fill.filledAt, campaignId, fill.profileId, exposureKey);
    }
    linkExploratoryPaperExecution({ campaignId, profileId: fill.profileId, fillId: fill.id,
      orderId: fill.orderId, createdAtMs: fill.filledAt }, database);
    return true;
  });
}

export function saveExploratoryPaperValuation(value: ExploratoryPaperValuationV1, database: Db): boolean {
  const { id: _id, contentHash: _contentHash, ...material } = value;
  void _id;
  void _contentHash;
  if (exploratoryValuationHash(material) !== value.contentHash || value.id !== sha256Hex(`exploratory-valuation:${value.contentHash}`)) {
    throw new TypeError('Invalid exploratory valuation identity.');
  }
  return database.prepare(`INSERT OR IGNORE INTO exploratory_paper_valuations_v1
    (id,campaign_id,profile_id,as_of,equity_usd_text,benchmark_usd_text,estimated_costs_usd_text,
     unpriced_count,content_json,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    value.id, value.campaignId, value.profileId, value.asOfMs, value.equityUsd,
    value.buyAndHoldBenchmarkUsd, value.estimatedCostsUsd, value.unpricedCount,
    json(value), value.contentHash,
  ).changes === 1;
}

export function listExploratoryPaperValuations(
  campaignId: string,
  profileId: string,
  database: Db,
): readonly ExploratoryPaperValuationV1[] {
  return Object.freeze((database.prepare(`SELECT content_json FROM exploratory_paper_valuations_v1
    WHERE campaign_id=? AND profile_id=? ORDER BY as_of,id`).all(campaignId, profileId) as Array<{ content_json: string }>)
    .map((row) => Object.freeze(JSON.parse(row.content_json) as ExploratoryPaperValuationV1)));
}

export function exploratoryPaperExecutionFacts(
  campaignId: string,
  profileId: string,
  database: Db,
): Readonly<{ estimatedCostsUsd: string; submitted: number; filled: number; pending: number;
  expired: number; refused: number; noTrade: number }> {
  const costRows = database.prepare(`SELECT fill.venue_fee_text,fill.spread_cost_text,
      fill.slippage_cost_text,fill.impact_cost_text
    FROM paper_fills_v3 fill
    WHERE fill.profile_id=? AND fill.id IN (
      SELECT DISTINCT fill_id FROM exploratory_paper_execution_links_v1
      WHERE campaign_id=? AND profile_id=? AND fill_id IS NOT NULL
    )`).all(profileId, campaignId, profileId) as Array<{
      venue_fee_text: string; spread_cost_text: string;
      slippage_cost_text: string; impact_cost_text: string;
    }>;
  const estimatedCostsUsd = costRows.reduce((total, row) => total
    .add(row.venue_fee_text).add(row.spread_cost_text)
    .add(row.slippage_cost_text).add(row.impact_cost_text), new Decimal(0));
  const pending = database.prepare(`SELECT COUNT(*) AS submitted,
      SUM(CASE WHEN pending.status='submitted' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN pending.status='expired' THEN 1 ELSE 0 END) AS expired
    FROM paper_pending_executions_v1 pending
    WHERE pending.profile_id=? AND pending.id IN (
      SELECT DISTINCT pending_id FROM exploratory_paper_execution_links_v1
      WHERE campaign_id=? AND profile_id=? AND pending_id IS NOT NULL
    )`).get(profileId, campaignId, profileId) as {
      submitted: number; pending: number | null; expired: number | null;
    };
  const outcomes = database.prepare(`SELECT
      SUM(CASE WHEN event.kind='execution_refused' THEN 1 ELSE 0 END) AS refused,
      SUM(CASE WHEN event.kind='no_trade' THEN 1 ELSE 0 END) AS no_trade
    FROM decision_evidence_events_v1 event
    WHERE event.profile_id=? AND event.decision_id IN (
      SELECT DISTINCT decision_id FROM exploratory_paper_execution_links_v1
      WHERE campaign_id=? AND profile_id=? AND decision_id IS NOT NULL
    )`).get(profileId, campaignId, profileId) as { refused: number | null; no_trade: number | null };
  return Object.freeze({ estimatedCostsUsd: estimatedCostsUsd.toFixed(),
    submitted: Number(pending.submitted), filled: costRows.length,
    pending: Number(pending.pending ?? 0), expired: Number(pending.expired ?? 0),
    refused: Number(outcomes.refused ?? 0), noTrade: Number(outcomes.no_trade ?? 0) });
}
