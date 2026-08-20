import json
import math
import struct
import sys

import numpy as np

UINT32 = 0xFFFFFFFF


def hash32(seed, sample, position):
    value = (seed ^ ((sample + 1) * 0x9E3779B1) ^ ((position + 1) * 0x85EBCA6B)) & UINT32
    value = ((value ^ (value >> 16)) * 0x7FEB352D) & UINT32
    value = ((value ^ (value >> 15)) * 0x846CA68B) & UINT32
    return (value ^ (value >> 16)) & UINT32


def run(header, closes):
    assets = header['assetCount']
    days = header['dayCount']
    if header.get('schemaVersion') != 1 or assets != 3 or days <= header['warmup'] or closes.size != assets * days:
        return {'ok': False, 'code': 'invalid_dimensions'}
    if not np.all(np.isfinite(closes)) or np.any(closes <= 0):
        return {'ok': False, 'code': 'invalid_price'}
    matrix = closes.reshape((assets, days))
    scores = []
    events = 0
    event_hash = 2166136261
    for candidate in range(header['candidateCount']):
        lookback = 90 if candidate & 1 == 0 else 180
        target = 40 if candidate & 2 == 0 else 50
        trend = 100 if candidate & 4 == 0 else 200
        cadence = 14 if candidate & 8 == 0 else 30
        score = 0.0
        for day in range(header['warmup'], days, cadence):
            events += 1
            event_hash = ((event_hash ^ ((candidate + 1) * 10000 + day)) * 16777619) & UINT32
            for asset in range(assets):
                finish = float(matrix[asset, day - 1])
                start = float(matrix[asset, day - 1 - lookback])
                momentum = finish / start - 1.0
                total = 0.0
                squares = 0.0
                for cursor in range(day - 30, day):
                    value = float(matrix[asset, cursor]) / float(matrix[asset, cursor - 1]) - 1.0
                    total += value
                    squares += value * value
                mean = total / 30.0
                variance = max(0.0, squares / 30.0 - mean * mean)
                annual_vol = math.sqrt(variance) * math.sqrt(365.0)
                defensive = 0.7 if finish < float(matrix[asset, day - trend]) else 1.0
                score += momentum * defensive * min(1.0, (target / 100.0) / max(annual_vol, 1e-12))
        scores.append(score)
    # Keep the accumulation order identical to TypeScript and Rust. NumPy owns
    # the packed view and validation, but a vectorized reduction may associate
    # additions differently and would invalidate the exact-parity gate.
    returns = np.empty(days - 1, dtype=np.float64)
    for day in range(1, days):
        value = 0.0
        for asset in range(assets):
            value += float(matrix[asset, day]) / float(matrix[asset, day - 1]) - 1.0
        returns[day - 1] = value / assets
    means = []
    non_negative = 0
    positions = np.arange(1, returns.size + 1, dtype=np.uint32)
    position_mix = positions * np.uint32(0x85EBCA6B)
    for sample in range(header['bootstrapResamples']):
        indexes = np.uint32(header['seed']) ^ np.uint32(((sample + 1) * 0x9E3779B1) & UINT32) ^ position_mix
        indexes = (indexes ^ (indexes >> np.uint32(16))) * np.uint32(0x7FEB352D)
        indexes = (indexes ^ (indexes >> np.uint32(15))) * np.uint32(0x846CA68B)
        indexes = (indexes ^ (indexes >> np.uint32(16))) % np.uint32(returns.size)
        # accumulate is intentionally used instead of sum: its left-to-right
        # recurrence matches the authoritative JS/Rust addition order.
        total = float(np.add.accumulate(returns[indexes], dtype=np.float64)[-1])
        mean = total / returns.size
        means.append(mean)
        if mean >= 0:
            non_negative += 1
    means.sort()
    return {'ok': True, 'scores': scores, 'events': events, 'eventOrderHash': event_hash,
            'bootstrapLower': means[math.floor(header['bootstrapResamples'] * 0.025)],
            'bootstrapUpper': means[math.floor(header['bootstrapResamples'] * 0.975)],
            'nonNegativeProbability': non_negative / header['bootstrapResamples']}


def read_exact(size):
    data = sys.stdin.buffer.read(size)
    if len(data) != size:
        raise EOFError
    return data


while True:
    try:
        frame_size = struct.unpack('<I', read_exact(4))[0]
        frame = read_exact(frame_size)
        if len(frame) < 4:
            raise ValueError('invalid_frame')
        header_size = struct.unpack('<I', frame[:4])[0]
        header_end = 4 + header_size
        if header_end > len(frame):
            raise ValueError('invalid_frame')
        header = json.loads(frame[4:header_end])
        closes = np.frombuffer(frame[header_end:], dtype='<f8')
        encoded = json.dumps(run(header, closes), separators=(',', ':')).encode()
        sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except EOFError:
        break
