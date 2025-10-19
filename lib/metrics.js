function clamp(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return Math.min(Math.max(value, min), max);
}

function quartileSegments(times, totalDuration) {
  const durationSeconds = times[times.length - 1] ?? totalDuration;
  const boundaries = [0.25, 0.5, 0.75].map((fraction) => durationSeconds * fraction);

  const segments = [];
  let currentBoundaryIndex = 0;
  let currentStart = 0;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    if (currentBoundaryIndex < boundaries.length && t >= boundaries[currentBoundaryIndex]) {
      segments.push([currentStart, i]);
      currentStart = i;
      currentBoundaryIndex += 1;
    }
  }

  segments.push([currentStart, times.length - 1]);

  while (segments.length < 4) {
    segments.push([times.length - 1, times.length - 1]);
  }

  return segments.slice(0, 4);
}

function combineSegments(a, b) {
  if (!a || !b) {
    return null;
  }
  return [a[0], b[1]];
}

function sliceSegment(arr, segment) {
  if (!segment) {
    return [];
  }
  const [start, end] = segment;
  if (!arr || start == null || end == null) {
    return [];
  }
  return arr.slice(start, end + 1);
}

function rebaseTime(values) {
  if (!values || values.length === 0) {
    return [];
  }
  const offset = values[0];
  return values.map((value) => value - offset);
}

function mean(values) {
  if (!values || values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function weightedMean(values, times) {
  if (!values || values.length === 0) {
    return null;
  }
  let sum = 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const duration = i < times.length - 1 ? times[i + 1] - times[i] : 1;
    sum += values[i] * duration;
    total += duration;
  }
  if (total === 0) {
    return null;
  }
  return sum / total;
}

function rollingAverage(values, times, windowSeconds) {
  if (!values || values.length === 0) {
    return [];
  }
  const results = [];
  let start = 0;
  let sum = 0;
  for (let end = 0; end < values.length; end += 1) {
    sum += values[end];
    while (times[end] - times[start] > windowSeconds && start < end) {
      sum -= values[start];
      start += 1;
    }
    const count = end - start + 1;
    if (times[end] - times[start] >= windowSeconds - 1) {
      results.push({ start, end, average: sum / count });
    }
  }
  return results;
}

function percentageChange(oldValue, newValue) {
  if (oldValue == null || newValue == null || oldValue === 0) {
    return null;
  }
  return ((newValue - oldValue) / oldValue) * 100;
}

function normalizedPower(values, times) {
  if (!values || values.length < 30) {
    return null;
  }
  const rebased = rebaseTime(times);
  const rolling = rollingAverage(values, rebased, 30);
  if (rolling.length === 0) {
    return null;
  }
  const fourthPowerMean =
    rolling.reduce((acc, item) => acc + item.average ** 4, 0) / rolling.length;
  return fourthPowerMean ** 0.25;
}

function linearRegressionSlope(xs, ys) {
  if (!xs || !ys || xs.length !== ys.length || xs.length < 2) {
    return null;
  }

  const meanX = xs.reduce((acc, value) => acc + value, 0) / xs.length;
  const meanY = ys.reduce((acc, value) => acc + value, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    numerator += dx * (ys[i] - meanY);
    denominator += dx * dx;
  }

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function computeBestAveragePower(values, times, windowSeconds, startTime) {
  if (!values || !times || values.length < 2) {
    return null;
  }

  const rebasedTimes = times;
  let startIndex = rebasedTimes.findIndex((value) => value >= startTime);
  if (startIndex === -1) {
    return null;
  }

  let best = null;
  let sum = 0;
  let count = 0;
  let start = startIndex;

  for (let end = startIndex; end < values.length; end += 1) {
    sum += values[end];
    count += 1;

    while (rebasedTimes[end] - rebasedTimes[start] > windowSeconds && start < end) {
      sum -= values[start];
      count -= 1;
      start += 1;
    }

    if (rebasedTimes[end] - rebasedTimes[start] >= windowSeconds - 1) {
      const average = count > 0 ? sum / count : null;
      if (average != null && (best == null || average > best)) {
        best = average;
      }
    }
  }

  return best;
}

function ratioToPercent(value) {
  if (value == null) {
    return null;
  }
  return value * 100;
}

function computeTimeInRange(times, values, [min, max]) {
  if (!values || !times || values.length === 0) {
    return { seconds: 0, ratio: 0 };
  }
  let seconds = 0;
  let total = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    const duration = times[i + 1] - times[i];
    total += duration;
    if (values[i] >= min && values[i] <= max) {
      seconds += duration;
    }
  }
  const ratio = total ? seconds / total : 0;
  return { seconds, ratio };
}

function computeHrrTimeInRange(times, values, { heartRateRest, heartRateMax, minPercent, maxPercent }) {
  if (!values || !times || values.length === 0) {
    return { seconds: 0, ratio: 0 };
  }
  const reserve = heartRateMax - heartRateRest;
  if (reserve <= 0) {
    return computeTimeInRange(times, values, [0, 0]);
  }
  let seconds = 0;
  let total = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    const duration = times[i + 1] - times[i];
    total += duration;
    const hrr = ((values[i] - heartRateRest) / reserve) * 100;
    if (hrr >= minPercent && hrr <= maxPercent) {
      seconds += duration;
    }
  }
  const ratio = total ? seconds / total : 0;
  return { seconds, ratio };
}

function filterByRange(pairs, targets) {
  const { center, tolerance } = targets;
  const min = center - tolerance;
  const max = center + tolerance;
  return pairs.filter((pair) => pair.hr >= min && pair.hr <= max);
}

export function sanitizeStreams(streams) {
  const time = streams.time?.data ?? [];
  const watts = streams.watts?.data?.map((value) => clamp(value, 0, 2000)) ?? [];
  const heartrate = streams.heartrate?.data?.map((value) => clamp(value, 40, 220)) ?? [];
  const distance = streams.distance?.data ?? [];
  const altitude = streams.altitude?.data ?? [];
  const velocity = streams.velocity_smooth?.data ?? [];
  const cadence = streams.cadence?.data ?? [];

  return { time, watts, heartrate, distance, altitude, velocity, cadence };
}

export function computeSegments(streams) {
  const { time } = streams;
  if (!time || time.length === 0) {
    return null;
  }

  const quartiles = quartileSegments(time, time[time.length - 1]);
  const firstHalf = combineSegments(quartiles[0], quartiles[1]);
  const secondHalf = combineSegments(quartiles[2], quartiles[3]);

  return {
    quartiles,
    firstHalf,
    secondHalf,
    early: quartiles[0],
    late: quartiles[3],
  };
}

export function calculateMetrics(streams, options = {}) {
  const { time, watts, heartrate, cadence } = streams;
  if (!time || time.length < 10 || watts.length < 10 || heartrate.length < 10) {
    return { error: 'Insufficient data' };
  }

  const segments = computeSegments(streams);
  if (!segments) {
    return { error: 'Unable to split segments' };
  }

  const earlyWatts = sliceSegment(watts, segments.firstHalf);
  const earlyHr = sliceSegment(heartrate, segments.firstHalf);
  const earlyTime = rebaseTime(sliceSegment(time, segments.firstHalf));
  const lateWatts = sliceSegment(watts, segments.secondHalf);
  const lateHr = sliceSegment(heartrate, segments.secondHalf);
  const lateTime = rebaseTime(sliceSegment(time, segments.secondHalf));

  const earlyPw = mean(earlyWatts) / Math.max(mean(earlyHr) ?? 1, 1);
  const latePw = mean(lateWatts) / Math.max(mean(lateHr) ?? 1, 1);
  const pwHrDrift = percentageChange(earlyPw, latePw);

  const earlyRolling = rollingAverage(earlyWatts, earlyTime, 300);
  const lateRolling = rollingAverage(lateWatts, lateTime, 300);
  const earlyBest = earlyRolling.reduce((acc, item) => (item.average > acc ? item.average : acc), 0);
  const lateBest = lateRolling.reduce((acc, item) => (item.average > acc ? item.average : acc), 0);
  const rolling5Diff = lateBest - earlyBest;

  const powerBand = { center: 150, tolerance: 2.5 };
  const earlyPowerAtHr = mean(
    filterByRange(
      earlyHr.map((value, idx) => ({ hr: value, power: earlyWatts[idx] })),
      {
        center: powerBand.center,
        tolerance: powerBand.tolerance,
      },
    ).map((pair) => pair.power),
  );
  const latePowerAtHr = mean(
    filterByRange(
      lateHr.map((value, idx) => ({ hr: value, power: lateWatts[idx] })),
      {
        center: powerBand.center,
        tolerance: powerBand.tolerance,
      },
    ).map((pair) => pair.power),
  );
  const power150Delta =
    earlyPowerAtHr != null && latePowerAtHr != null ? latePowerAtHr - earlyPowerAtHr : null;

  const { heartRateMax, heartRateRest } = options;
  const z2Calculator =
    heartRateMax && heartRateRest
      ? (times, hr) =>
          computeHrrTimeInRange(times, hr, {
            heartRateRest,
            heartRateMax,
            minPercent: 60,
            maxPercent: 70,
          })
      : (times, hr) => computeTimeInRange(times, hr, [120, 150]);

  const earlyZ2 = z2Calculator(rebaseTime(sliceSegment(time, segments.early)), sliceSegment(heartrate, segments.early));
  const lateZ2 = z2Calculator(rebaseTime(sliceSegment(time, segments.late)), sliceSegment(heartrate, segments.late));

  const earlyCadence = sliceSegment(cadence, segments.early);
  const lateCadence = sliceSegment(cadence, segments.late);
  const cadenceDrop = mean(earlyCadence) != null && mean(lateCadence) != null ? mean(lateCadence) - mean(earlyCadence) : null;
  const hrCreep = mean(lateHr) != null && mean(earlyHr) != null ? mean(lateHr) - mean(earlyHr) : null;

  const quartileSummaries = segments.quartiles.map((segment) => {
    const wattsSegment = sliceSegment(watts, segment);
    const hrSegment = sliceSegment(heartrate, segment);
    const timeSegment = rebaseTime(sliceSegment(time, segment));
    const avgPower = mean(wattsSegment);
    const np = normalizedPower(wattsSegment, timeSegment);
    const avgHr = mean(hrSegment);
    const ef = avgHr ? (np ?? avgPower ?? 0) / avgHr : null;
    return {
      avgPower,
      normalizedPower: np,
      avgHr,
      efficiencyFactor: ef,
    };
  });

  const powerFade =
    quartileSummaries[0]?.avgPower != null && quartileSummaries[3]?.avgPower != null
      ? ((quartileSummaries[0].avgPower - quartileSummaries[3].avgPower) / quartileSummaries[0].avgPower) * 100
      : null;

  const efficiencyEarly = quartileSummaries[0]?.efficiencyFactor ?? null;
  const efficiencyLate = quartileSummaries[3]?.efficiencyFactor ?? null;
  const efficiencyDecline =
    efficiencyEarly != null && efficiencyLate != null && efficiencyEarly !== 0
      ? ((efficiencyEarly - efficiencyLate) / efficiencyEarly) * 100
      : null;

  const wattsPerBeat = [];
  const ratioTimes = [];
  for (let i = 0; i < watts.length; i += 1) {
    const hr = heartrate[i];
    const power = watts[i];
    if (hr && hr > 0 && power != null) {
      wattsPerBeat.push(power / hr);
      ratioTimes.push(time[i]);
    }
  }

  const rebasedRatioTimes = rebaseTime(ratioTimes);
  const slopePerSecond = linearRegressionSlope(rebasedRatioTimes, wattsPerBeat);
  const slopePerHour = slopePerSecond != null ? slopePerSecond * 3600 : null;
  const meanRatio = wattsPerBeat.length > 0 ? mean(wattsPerBeat) : null;
  const slopePercentPerHour =
    slopePerHour != null && meanRatio
      ? (slopePerHour / meanRatio) * 100
      : null;

  const offsets = [0, 3600, 7200, 10800];
  const durations = [300, 600, 1200, 3600];
  const totalDuration = time[time.length - 1] ?? 0;
  const fatigueResistance = offsets
    .filter((offset) => totalDuration >= offset + 300)
    .map((offset) => {
      const bestByDuration = durations.reduce((acc, duration) => {
        if (totalDuration < offset + duration) {
          return acc;
        }
        const best = computeBestAveragePower(watts, time, duration, offset);
        if (best != null) {
          acc[duration] = best;
        }
        return acc;
      }, {});
      return {
        offset,
        bestByDuration,
      };
    })
    .filter((entry) => Object.keys(entry.bestByDuration).length > 0);

  const durabilityScoreComponents = [];
  if (powerFade != null) {
    durabilityScoreComponents.push(100 - clamp(Math.max(powerFade, 0), 0, 100));
  }
  if (pwHrDrift != null) {
    const driftPenalty = Math.max(pwHrDrift, 0);
    durabilityScoreComponents.push(100 - clamp(driftPenalty, 0, 100));
  }
  if (efficiencyDecline != null) {
    const efficiencyPenalty = Math.max(efficiencyDecline, 0);
    durabilityScoreComponents.push(100 - clamp(efficiencyPenalty, 0, 100));
  }
  if (slopePercentPerHour != null) {
    const slopePenalty = Math.max(-slopePercentPerHour, 0);
    durabilityScoreComponents.push(100 - clamp(slopePenalty, 0, 100));
  }
  const durabilityScore =
    durabilityScoreComponents.length > 0
      ? Math.max(
          0,
          Math.min(100, durabilityScoreComponents.reduce((acc, value) => acc + value, 0) / durabilityScoreComponents.length),
        )
      : null;

  return {
    segments,
    pwHrDrift,
    rolling5Diff,
    power150Delta,
    z2Early: ratioToPercent(earlyZ2.ratio),
    z2Late: ratioToPercent(lateZ2.ratio),
    cadenceDrop,
    hrCreep,
    quartiles: quartileSummaries,
    powerFade,
    efficiencyDecline,
    wattsPerBeatTrend: {
      slopePerHour,
      slopePercentPerHour,
      start: wattsPerBeat[0] ?? null,
      end: wattsPerBeat[wattsPerBeat.length - 1] ?? null,
      mean: meanRatio,
    },
    fatigueResistance,
    durabilityScore,
    efficiencyFactor: {
      early: efficiencyEarly,
      late: efficiencyLate,
    },
  };
}

export function computeDurabilityBaseline(metricsHistory) {
  if (!metricsHistory || metricsHistory.length === 0) {
    return null;
  }

  const aggregate = metricsHistory.reduce(
    (acc, row) => {
      const update = (key, value) => {
        if (value == null) return;
        acc[key].total += Number(value);
        acc[key].count += 1;
      };
      update('pwHrDrift', row.pw_hr_drift);
      update('rolling5Diff', row.rolling5_diff);
      update('power150Delta', row.power_150_delta);
      update('z2Early', row.z2_early);
      update('z2Late', row.z2_late);
      update('cadenceDrop', row.cadence_drop);
      update('hrCreep', row.hr_creep);
      return acc;
    },
    {
      pwHrDrift: { total: 0, count: 0 },
      rolling5Diff: { total: 0, count: 0 },
      power150Delta: { total: 0, count: 0 },
      z2Early: { total: 0, count: 0 },
      z2Late: { total: 0, count: 0 },
      cadenceDrop: { total: 0, count: 0 },
      hrCreep: { total: 0, count: 0 },
    },
  );

  const average = (key) => {
    const { total, count } = aggregate[key];
    return count > 0 ? total / count : null;
  };

  return {
    pwHrDrift: average('pwHrDrift'),
    rolling5Diff: average('rolling5Diff'),
    power150Delta: average('power150Delta'),
    z2Early: average('z2Early'),
    z2Late: average('z2Late'),
    cadenceDrop: average('cadenceDrop'),
    hrCreep: average('hrCreep'),
  };
}

export function computeHrrZones({ heartRateMax, heartRateRest, heartrate }) {
  if (!heartRateMax || !heartRateRest || !heartrate || heartrate.length === 0) {
    return null;
  }
  const reserve = heartRateMax - heartRateRest;
  if (reserve <= 0) {
    return null;
  }

  const inZ2 = heartrate.filter((value) => {
    const hrr = ((value - heartRateRest) / reserve) * 100;
    return hrr >= 60 && hrr <= 70;
  });

  return {
    z2HrrShare: (inZ2.length / heartrate.length) * 100,
  };
}

export function summarizeCadenceFatigue(cadenceDrop, hrCreep) {
  if (cadenceDrop == null && hrCreep == null) {
    return 'Cadence fatigue not detected.';
  }
  const parts = [];
  if (cadenceDrop != null) {
    parts.push(`Cadence change: ${cadenceDrop.toFixed(1)} rpm`);
  }
  if (hrCreep != null) {
    parts.push(`HR creep: ${hrCreep.toFixed(1)} bpm`);
  }
  if (cadenceDrop != null && cadenceDrop < -5 && hrCreep != null && hrCreep > 5) {
    parts.push('⚠️ Cadence drop with HR creep suggests accumulating fatigue.');
  }
  return parts.join(' | ');
}
