use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use serde::Serialize;

const UINT32_MASK: u64 = 0xffff_ffff;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Success {
    ok: bool,
    scores: Vec<f64>,
    events: u32,
    event_order_hash: u32,
    bootstrap_lower: f64,
    bootstrap_upper: f64,
    non_negative_probability: f64,
}

#[derive(Serialize)]
struct Failure<'a> {
    ok: bool,
    code: &'a str,
}

fn hash32(seed: u32, sample: u32, position: u32) -> u32 {
    let mut value = (seed as u64
        ^ (sample.wrapping_add(1).wrapping_mul(0x9e37_79b1)) as u64
        ^ (position.wrapping_add(1).wrapping_mul(0x85eb_ca6b)) as u64)
        & UINT32_MASK;
    value = ((value ^ (value >> 16)) * 0x7feb_352d) & UINT32_MASK;
    value = ((value ^ (value >> 15)) * 0x846c_a68b) & UINT32_MASK;
    (value ^ (value >> 16)) as u32
}

fn failure(code: &str) -> String {
    serde_json::to_string(&Failure { ok: false, code }).expect("failure is serializable")
}

#[napi]
pub fn run_kernel(
    closes: Float64Array,
    schema_version: u32,
    asset_count: u32,
    day_count: u32,
    candidate_count: u32,
    warmup: u32,
    bootstrap_resamples: u32,
    seed: u32,
) -> String {
    let assets = asset_count as usize;
    let days = day_count as usize;
    if schema_version != 1
        || assets != 3
        || days <= warmup as usize
        || closes.len() != assets * days
    {
        return failure("invalid_dimensions");
    }
    if closes.iter().any(|value| !value.is_finite() || *value <= 0.0) {
        return failure("invalid_price");
    }

    let mut scores = Vec::with_capacity(candidate_count as usize);
    let mut events = 0_u32;
    let mut event_order_hash = 2_166_136_261_u32;
    for candidate in 0..candidate_count {
        let lookback = if candidate & 1 == 0 { 90 } else { 180 };
        let target = if candidate & 2 == 0 { 40.0 } else { 50.0 };
        let trend = if candidate & 4 == 0 { 100 } else { 200 };
        let cadence = if candidate & 8 == 0 { 14 } else { 30 };
        let mut score = 0.0;
        let mut day = warmup as usize;
        while day < days {
            events = events.wrapping_add(1);
            event_order_hash = (event_order_hash
                ^ ((candidate + 1).wrapping_mul(10_000).wrapping_add(day as u32)))
                .wrapping_mul(16_777_619);
            for asset in 0..assets {
                let offset = asset * days;
                let finish = closes[offset + day - 1];
                let start = closes[offset + day - 1 - lookback];
                let momentum = finish / start - 1.0;
                let mut sum = 0.0;
                let mut sum_squares = 0.0;
                for cursor in day - 30..day {
                    let value = closes[offset + cursor] / closes[offset + cursor - 1] - 1.0;
                    sum += value;
                    sum_squares += value * value;
                }
                let mean = sum / 30.0;
                let variance = (sum_squares / 30.0 - mean * mean).max(0.0);
                let annual_vol = variance.sqrt() * 365.0_f64.sqrt();
                let defensive = if finish < closes[offset + day - trend] { 0.7 } else { 1.0 };
                score += momentum
                    * defensive
                    * ((target / 100.0) / annual_vol.max(1e-12)).min(1.0);
            }
            day += cadence;
        }
        scores.push(score);
    }

    let mut portfolio_returns = Vec::with_capacity(days - 1);
    for day in 1..days {
        let mut value = 0.0;
        for asset in 0..assets {
            let offset = asset * days;
            value += closes[offset + day] / closes[offset + day - 1] - 1.0;
        }
        portfolio_returns.push(value / assets as f64);
    }
    let mut bootstrap_means = Vec::with_capacity(bootstrap_resamples as usize);
    let mut non_negative = 0_u32;
    for sample in 0..bootstrap_resamples {
        let mut sum = 0.0;
        for position in 0..portfolio_returns.len() {
            let index = hash32(seed, sample, position as u32) as usize % portfolio_returns.len();
            sum += portfolio_returns[index];
        }
        let mean = sum / portfolio_returns.len() as f64;
        bootstrap_means.push(mean);
        if mean >= 0.0 {
            non_negative += 1;
        }
    }
    bootstrap_means.sort_by(|left, right| left.total_cmp(right));
    let lower = bootstrap_means[(bootstrap_resamples as f64 * 0.025).floor() as usize];
    let upper = bootstrap_means[(bootstrap_resamples as f64 * 0.975).floor() as usize];
    serde_json::to_string(&Success {
        ok: true,
        scores,
        events,
        event_order_hash,
        bootstrap_lower: lower,
        bootstrap_upper: upper,
        non_negative_probability: non_negative as f64 / bootstrap_resamples as f64,
    })
    .expect("success is serializable")
}
