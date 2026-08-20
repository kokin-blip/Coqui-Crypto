const UINT32 = 0x1_0000_0000;

function hash32(seed, sample, position) {
  let value = (seed ^ Math.imul(sample + 1, 0x9e3779b1) ^ Math.imul(position + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function generateInput(dayCount = 3_860) {
  const assetCount = 3;
  const closes = new Float64Array(assetCount * dayCount);
  for (let asset = 0; asset < assetCount; asset += 1) {
    let price = 100 + asset * 37;
    for (let day = 0; day < dayCount; day += 1) {
      const cycle = Math.sin((day + asset * 11) / (37 + asset * 7)) * 0.012;
      const shock = ((hash32(2_026_080_9, asset, day) / UINT32) - 0.5) * 0.018;
      price *= 1 + 0.00035 + cycle + shock;
      closes[asset * dayCount + day] = price;
    }
  }
  return Object.freeze({ schemaVersion: 1, assetCount, dayCount, candidateCount: 16,
    warmup: 200, bootstrapResamples: 5_000, seed: 2_026_080_9, closes });
}

function candidateParameters(index) {
  return {
    lookback: (index & 1) === 0 ? 90 : 180,
    targetVol: (index & 2) === 0 ? 40 : 50,
    trend: (index & 4) === 0 ? 100 : 200,
    cadence: (index & 8) === 0 ? 14 : 30,
  };
}

export function runTypeScriptKernel(input) {
  if (input.schemaVersion !== 1 || input.assetCount !== 3 || input.dayCount <= input.warmup ||
      input.closes.length !== input.assetCount * input.dayCount) {
    return Object.freeze({ ok: false, code: 'invalid_dimensions' });
  }
  for (const value of input.closes) {
    if (!Number.isFinite(value) || value <= 0) return Object.freeze({ ok: false, code: 'invalid_price' });
  }
  const scores = [];
  let events = 0;
  let eventOrderHash = 2_166_136_261;
  for (let candidate = 0; candidate < input.candidateCount; candidate += 1) {
    const config = candidateParameters(candidate);
    let score = 0;
    for (let day = input.warmup; day < input.dayCount; day += config.cadence) {
      events += 1;
      eventOrderHash = Math.imul(eventOrderHash ^ ((candidate + 1) * 10_000 + day), 16_777_619) >>> 0;
      for (let asset = 0; asset < input.assetCount; asset += 1) {
        const offset = asset * input.dayCount;
        const finish = input.closes[offset + day - 1];
        const start = input.closes[offset + day - 1 - config.lookback];
        const momentum = finish / start - 1;
        let sum = 0;
        let sumSquares = 0;
        for (let cursor = day - 30; cursor < day; cursor += 1) {
          const value = input.closes[offset + cursor] / input.closes[offset + cursor - 1] - 1;
          sum += value;
          sumSquares += value * value;
        }
        const mean = sum / 30;
        const variance = Math.max(0, sumSquares / 30 - mean * mean);
        const annualVol = Math.sqrt(variance) * Math.sqrt(365);
        const trendStart = input.closes[offset + day - config.trend];
        const defensive = finish < trendStart ? 0.7 : 1;
        score += momentum * defensive * Math.min(1, (config.targetVol / 100) / Math.max(annualVol, 1e-12));
      }
    }
    scores.push(score);
  }
  const portfolioReturns = new Float64Array(input.dayCount - 1);
  for (let day = 1; day < input.dayCount; day += 1) {
    let value = 0;
    for (let asset = 0; asset < input.assetCount; asset += 1) {
      const offset = asset * input.dayCount;
      value += input.closes[offset + day] / input.closes[offset + day - 1] - 1;
    }
    portfolioReturns[day - 1] = value / input.assetCount;
  }
  const bootstrapMeans = new Array(input.bootstrapResamples);
  let nonNegative = 0;
  for (let sample = 0; sample < input.bootstrapResamples; sample += 1) {
    let sum = 0;
    for (let position = 0; position < portfolioReturns.length; position += 1) {
      const index = hash32(input.seed, sample, position) % portfolioReturns.length;
      sum += portfolioReturns[index];
    }
    const mean = sum / portfolioReturns.length;
    bootstrapMeans[sample] = mean;
    if (mean >= 0) nonNegative += 1;
  }
  bootstrapMeans.sort((left, right) => left - right);
  return Object.freeze({ ok: true, scores, events, eventOrderHash,
    bootstrapLower: bootstrapMeans[Math.floor(input.bootstrapResamples * 0.025)],
    bootstrapUpper: bootstrapMeans[Math.floor(input.bootstrapResamples * 0.975)],
    nonNegativeProbability: nonNegative / input.bootstrapResamples });
}
