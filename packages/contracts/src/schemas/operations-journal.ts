import * as z from 'zod';
import { epochMillisecondsSchema as time } from '../messages.js';
import { sha256HexSchema } from './provenance.js';

const worker=z.enum(['host','market','risk','research','execution','advisor']);
const id=z.string().min(1).max(256);
const status=z.enum(['running','completed','waiting','blocked','failed','unknown','cancelled']);
const source=z.enum(['paper_ledger','exploratory','parallel','research','advisor','host','market']);
const facts=z.partialRecord(z.enum(['instruments','reasonCode','gate','decisionId','runId','campaignId','proposalId',
  'orderId','clientOrderId','jobId','strategy','freshness','marketAsOfMs','momentumPct','volatilityPct','targetWeight','filledCount',
  'submittedCount','amountUsd','provider','operation','sourceRecord','contentHash','sequence','gatesPassed','attempt','deadlineAtMs']),
  z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()]));
const group=z.strictObject({id,label:z.string().max(700),source,scope:z.enum(['profile','global']),
  startedAtMs:time,updatedAtMs:time,status,entryCount:z.number().int().positive(),revision:sha256HexSchema});
const entry=z.strictObject({id,groupId:id,attemptId:id,worker,source,phase:z.string().max(80),status,atMs:time,
  scope:z.enum(['profile','global']),message:z.string().max(1000),facts,contentHash:z.string().max(128).nullable()});
const pagination={worker:worker.nullable(),limit:z.number().int().min(1).max(20),cursor:z.string().max(700).nullable()};
export const operationsJournalChannelSchemas={
  'operations.journal':{request:z.strictObject(pagination),response:z.strictObject({groups:z.array(group).max(20),
    coverage:z.array(z.strictObject({worker,lastAtMs:time.nullable(),status:z.enum(['available','unavailable'])})).length(6),
    nextCursor:z.string().max(700).nullable(),revision:z.string().max(160),asOfMs:time})},
  'operations.journal.group':{request:z.strictObject({...pagination,groupId:id,limit:z.number().int().min(1).max(50)}),
    response:z.strictObject({group,entries:z.array(entry).max(50),nextCursor:z.string().max(700).nullable(),
      historyComplete:z.boolean(),revision:sha256HexSchema,asOfMs:time})},
} as const;
