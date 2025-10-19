function clamp(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return Math.min(Math.max(value, min), max);
}

function segmentIndices(times, totalDuration) {
  const durationSeconds = times[times.length - 1] ?? totalDuration;
  const splitCount = durationSeconds < 3600 ? 3 : 2;
  const boundaries = [];
  for (let i = 1; i < splitCount; i += 1) {
    boundaries.push((durationSeconds * i) / splitCount);
  }

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

  if (splitCount === 3) {
    return { splitCount, early: segments[0], middle: segments[1], late: segments[2] };
  }

  return { splitCount, early: segments[0], late: segments[1] };
}

function sliceSegment(arr, [start, end]) {
  if (!arr || start == null || end == null) {
    return [];
  }
  return arr.slice(start, end + 1);
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

  const segments = segmentIndices(time, time[time.length - 1]);
  return segments;
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

  const earlyWatts = sliceSegment(watts, segments.early);
  const earlyHr = sliceSegment(heartrate, segments.early);
  const earlyTime = sliceSegment(time, segments.early);
  const lateWatts = sliceSegment(watts, segments.late);
  const lateHr = sliceSegment(heartrate, segments.late);
  const lateTime = sliceSegment(time, segments.late);

  const earlyPw = mean(earlyWatts) / Math.max(mean(earlyHr) ?? 1, 1);
  const latePw = mean(lateWatts) / Math.max(mean(lateHr) ?? 1, 1);
  const pwHrDrift = percentageChange(earlyPw, latePw);

  const earlyRolling = rollingAverage(earlyWatts, earlyTime, 300);
  const lateRolling = rollingAverage(lateWatts, lateTime, 300);
  const earlyBest = earlyRolling.reduce((acc, item) => (item.average > acc ? item.average : acc), 0);
  const lateBest = lateRolling.reduce((acc, item) => (item.average > acc ? item.average : acc), 0);
  const rolling5Diff = lateBest - earlyBest;

  const powerBand = { center: 150, tolerance: 2.5 };
  const earlyPowerAtHr = mean(filterByRange(earlyHr.map((value, idx) => ({ hr: value, power: earlyWatts[idx] })), {
    center: powerBand.center,
    tolerance: powerBand.tolerance,
  }).map((pair) => pair.power));
  const latePowerAtHr = mean(filterByRange(lateHr.map((value, idx) => ({ hr: value, power: lateWatts[idx] })), {
    center: powerBand.center,
    tolerance: powerBand.tolerance,
  }).map((pair) => pair.power));
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

  const earlyZ2 = z2Calculator(earlyTime, earlyHr);
  const lateZ2 = z2Calculator(lateTime, lateHr);

  const earlyCadence = sliceSegment(cadence, segments.early);
  const lateCadence = sliceSegment(cadence, segments.late);
  const cadenceDrop = mean(earlyCadence) != null && mean(lateCadence) != null ? mean(lateCadence) - mean(earlyCadence) : null;
  const hrCreep = mean(lateHr) != null && mean(earlyHr) != null ? mean(lateHr) - mean(earlyHr) : null;

  return {
    segments,
    pwHrDrift,
    rolling5Diff,
    power150Delta,
    z2Early: ratioToPercent(earlyZ2.ratio),
    z2Late: ratioToPercent(lateZ2.ratio),
    cadenceDrop,
    hrCreep,
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
