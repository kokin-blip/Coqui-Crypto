import { expect, it } from 'vitest';
import type { NewsAnalysisRun, NewsClusterSnapshot, NewsFeatureSnapshot, NewsIntelligenceConfiguration,
  NewsObservationAnalysis } from '@coqui/core';
import { newsAnalysisRunSchema, newsClusterSnapshotSchema, newsFeatureSnapshotSchema,
  newsIntelligenceConfigurationSchema, newsObservationAnalysisSchema } from '@coqui/contracts';

type Compatible<A, B> = A extends B ? B extends A ? true : never : never;
const compatibility: readonly [
  Compatible<ReturnType<typeof newsIntelligenceConfigurationSchema.parse>, NewsIntelligenceConfiguration>,
  Compatible<ReturnType<typeof newsObservationAnalysisSchema.parse>, NewsObservationAnalysis>,
  Compatible<ReturnType<typeof newsClusterSnapshotSchema.parse>, NewsClusterSnapshot>,
  Compatible<ReturnType<typeof newsFeatureSnapshotSchema.parse>, NewsFeatureSnapshot>,
  Compatible<ReturnType<typeof newsAnalysisRunSchema.parse>, NewsAnalysisRun>,
] = [true, true, true, true, true];

it('keeps domain types bidirectionally compatible with runtime schemas', () => {
  expect(compatibility).toEqual([true, true, true, true, true]);
});
