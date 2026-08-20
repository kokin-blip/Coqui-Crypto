/** Quarantined benchmark wire contract. It is not a production package API. */
export interface ResearchKernelV1Input {
  readonly schemaVersion: 1;
  readonly assetCount: 3;
  readonly dayCount: number;
  readonly candidateCount: 16;
  readonly warmup: number;
  readonly bootstrapResamples: number;
  readonly seed: number;
  /** Asset-major, canonical asset order. */
  readonly closes: Float64Array;
}

export type ResearchKernelV1FailureCode = 'invalid_dimensions' | 'invalid_price';

export type ResearchKernelV1Output =
  | Readonly<{ ok: false; code: ResearchKernelV1FailureCode }>
  | Readonly<{
      ok: true;
      scores: readonly number[];
      events: number;
      eventOrderHash: number;
      bootstrapLower: number;
      bootstrapUpper: number;
      nonNegativeProbability: number;
    }>;

export interface ResearchKernelV1 {
  readonly name: 'typescript' | 'rust-napi' | 'python-numpy-worker';
  run(input: ResearchKernelV1Input): Promise<ResearchKernelV1Output>;
  close(): Promise<void>;
}
