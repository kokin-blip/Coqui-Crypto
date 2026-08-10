# Benchmark-relative uncertainty — 2026-08-09

## Decision

A positive point estimate is no longer enough to claim that a selected strategy
beats hold or passive. Coqui now evaluates the paired, after-cost daily excess
return against each benchmark on the final holdout.

The method uses the stationary bootstrap introduced by Politis and Romano,
[The Stationary Bootstrap](https://doi.org/10.1080/01621459.1994.10476870),
which is designed for confidence regions under weakly dependent stationary
observations. The null-centered one-sided test follows the benchmark-superiority
question in White's
[A Reality Check for Data Snooping](https://doi.org/10.1111/1468-0262.00152).

For each benchmark, Coqui:

1. forms synchronous daily `selected − benchmark` returns;
2. resamples contiguous runs with geometrically distributed lengths;
3. takes percentile bounds from the raw paired-excess bootstrap distribution;
4. centers excess at zero and estimates the one-sided no-edge p-value; and
5. reports the observed daily mean and its arithmetic annualization separately.

The paired design preserves same-day covariance. Block resampling preserves
short-range serial dependence rather than treating daily crypto observations as
independent.

## Frozen settings and adoption

The proposed real study freezes these values before execution:

- 5,000 resamples;
- mean block length of 20 daily returns;
- 95% two-sided percentile interval; and
- deterministic seed `20260809` (`+1`, modulo 32 bits, for passive).

The plan schema accepts 500–100,000 resamples and requires all settings and the
seed up front. At least 30 paired returns are required, and mean block length
cannot exceed the sample.

Adoption requires both the hold and passive analyses to be available and both
lower confidence bounds to be strictly positive. The point estimates, PBO, DSR,
drawdown gate, and confidence bounds are separate required checks; strength in
one cannot compensate for failure or missing data in another.

## Interpretation limits

The interval describes uncertainty in mean daily paired excess under the
observed dependent return process. Arithmetic annualization is clearly labelled
and is not presented as a compounded return forecast. The bootstrap does not
create new market regimes, repair survivorship bias, resolve the historical
trial-count lower bound, or justify repeated access to the final holdout.

Tests cover a stable positive paired edge, a dependent zero-mean excess series,
determinism, short and unpaired inputs, invalid blocks, and end-to-end holdout
integration.
