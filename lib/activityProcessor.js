import {
  calculateMetrics,
  computeDurabilityBaseline,
  computeHrrZones,
  sanitizeStreams,
  summarizeCadenceFatigue,
} from './metrics.js';
import {
  fetchActivity,
  fetchStreams,
  getValidToken,
  updateActivityDescription,
} from './strava.js';
import { loadBaselineMetrics, markActivityProcessed, saveAthleteMetrics, isActivityProcessed } from './db.js';

const MARKER = '[DurableRider summary v0.1]';
const LEGACY_MARKERS = ['<!-- durability-post v0.1 -->', '<!-- durability-post -->'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripExistingBlock(description) {
  if (!description) {
    return '';
  }
  const markers = [MARKER, ...LEGACY_MARKERS];
  return markers
    .reduce((text, marker) => {
      const regex = new RegExp(`${escapeRegExp(marker)}[\s\S]*?$`, 'm');
      return text.replace(regex, '').trim();
    }, description)
    .trim();
}

function formatNumber(value, { suffix = '', digits = 1, defaultText = 'n/a' } = {}) {
  if (value == null || Number.isNaN(value)) {
    return defaultText;
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function formatBaselineComparison(current, baseline, { suffix = '', digits = 1 } = {}) {
  if (current == null) {
    return 'n/a';
  }
  const value = formatNumber(current, { suffix, digits });
  if (baseline == null) {
    return value;
  }
  const delta = current - baseline;
  const sign = delta >= 0 ? '+' : '';
  const deltaText = `${sign}${Math.abs(delta).toFixed(digits)}${suffix}`;
  return `${value} (${deltaText} vs baseline)`;
}

function buildDescriptionBlock({ metrics, baseline, hrr, cadenceSummary, context }) {
  const durabilityScoreText =
    metrics.durabilityScore == null ? 'n/a' : `${Math.round(metrics.durabilityScore)}/100`;
  const lines = [
    MARKER,
    'Durability snapshot:',
    `• Durability score: ${durabilityScoreText}`,
    `• Power fade Q1→Q4: ${formatNumber(metrics.powerFade, { suffix: '%', digits: 1 })}`,
    `• Pw:HR drift (1st vs 2nd half): ${formatBaselineComparison(metrics.pwHrDrift, baseline?.pwHrDrift, { suffix: '%', digits: 1 })}`,
    `• Efficiency decline: ${formatNumber(metrics.efficiencyDecline, { suffix: '%', digits: 1, defaultText: 'n/a' })}`,
    `• W/HR slope: ${formatNumber(metrics.wattsPerBeatTrend?.slopePercentPerHour, { suffix: '%/h', digits: 1 })}`,
    `• Rolling 5min delta: ${formatBaselineComparison(metrics.rolling5Diff, baseline?.rolling5Diff, { suffix: ' W', digits: 0 })}`,
    `• Power @150 bpm delta: ${formatBaselineComparison(metrics.power150Delta, baseline?.power150Delta, { suffix: ' W', digits: 0 })}`,
    `• Z2 share early→late: ${formatNumber(metrics.z2Early, { suffix: '%', digits: 1 })} → ${formatNumber(metrics.z2Late, { suffix: '%', digits: 1 })}`,
    `• Cadence/HR fatigue: ${cadenceSummary}`,
  ];

  if (hrr?.z2HrrShare != null) {
    lines.push(`• HRR-based Z2 share: ${formatNumber(hrr.z2HrrShare, { suffix: '%', digits: 1 })}`);
  }

  lines.push('');

  if (metrics.quartiles?.length) {
    lines.push('Quartile profile (Avg P | NP | HR | EF):');
    metrics.quartiles.forEach((quartile, index) => {
      const label = `Q${index + 1}`;
      const avgPower = formatNumber(quartile.avgPower, { suffix: ' W', digits: 0 });
      const np = formatNumber(quartile.normalizedPower, { suffix: ' W', digits: 0 });
      const hr = formatNumber(quartile.avgHr, { suffix: ' bpm', digits: 0 });
      const ef = formatNumber(quartile.efficiencyFactor, { digits: 2 });
      lines.push(`${label}: ${avgPower} | NP ${np} | ${hr} | EF ${ef}`);
    });
    lines.push('');
  }

  if (metrics.wattsPerBeatTrend) {
    const trend = metrics.wattsPerBeatTrend;
    const start = formatNumber(trend.start, { digits: 2 });
    const end = formatNumber(trend.end, { digits: 2 });
    lines.push(`W/HR trend: ${formatNumber(trend.slopePerHour, { digits: 2 })} W·bpm⁻¹/h (${start} → ${end})`);
    lines.push('');
  }

  if (metrics.fatigueResistance?.length) {
    lines.push('Fatigue resistance (best average power):');
    metrics.fatigueResistance.forEach((entry) => {
      const hours = (entry.offset / 3600).toFixed(1);
      const segments = Object.entries(entry.bestByDuration)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([duration, power]) => {
          const minutes = Math.round(Number(duration) / 60);
          return `${minutes}' ${formatNumber(power, { suffix: ' W', digits: 0 })}`;
        });
      if (segments.length > 0) {
        lines.push(`T+${hours}h → ${segments.join(' | ')}`);
      }
    });
    lines.push('');
  }

  if (context?.indoor != null) {
    const tags = [];
    tags.push(context.indoor ? 'Indoor' : 'Outdoor');
    if (context.temperature) {
      tags.push(`Temp: ${context.temperature}°C`);
    }
    if (context.altitude != null) {
      tags.push(`Altitude gain: ${context.altitude.toFixed(0)} m`);
    }
    lines.push(`• Ride context: ${tags.join(' | ')}`);
  }

  lines.push('');
  return `${lines.join('\n')}`;
}

export async function processActivity({ athleteId, activityId }) {
  const alreadyProcessed = await isActivityProcessed({ athleteId, activityId });
  if (alreadyProcessed) {
    console.log(`Skipping activity ${activityId} for athlete ${athleteId} — already processed.`);
    return;
  }

  try {
    const accessToken = await getValidToken(athleteId);
    const [activity, streamsRaw] = await Promise.all([
      fetchActivity(accessToken, activityId),
      fetchStreams(accessToken, activityId),
    ]);

    const streams = sanitizeStreams(streamsRaw);
    const metrics = calculateMetrics(streams, {
      heartRateMax: activity.athlete?.max_heartrate ?? activity.max_heartrate,
      heartRateRest: activity.athlete?.resting_heartrate ?? activity.resting_heartrate,
    });
    if (metrics.error) {
      console.warn(`Unable to compute metrics for activity ${activityId}: ${metrics.error}`);
      return;
    }

    const hrr = computeHrrZones({
      heartRateMax: activity.athlete?.max_heartrate ?? activity.max_heartrate,
      heartRateRest: activity.athlete?.resting_heartrate ?? activity.resting_heartrate,
      heartrate: streams.heartrate,
    });

    const sinceDate = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
    const history = await loadBaselineMetrics(athleteId, sinceDate);
    const baseline = computeDurabilityBaseline(history);

    const cadenceSummary = summarizeCadenceFatigue(metrics.cadenceDrop, metrics.hrCreep);

    const indoor = Boolean(
      activity.trainer ||
        activity.sport_type?.toLowerCase().includes('virtual') ||
        activity.workout_type === 11 ||
        activity.indoor,
    );

    const context = {
      indoor,
      temperature: activity.average_temp,
      altitude: activity.total_elevation_gain,
      sportType: activity.sport_type,
    };

    const block = buildDescriptionBlock({ metrics, baseline, hrr, cadenceSummary, context });

    console.log('Durability metrics', {
      athleteId,
      activityId,
      metrics,
      baseline,
      hrr,
      cadenceSummary,
    });

    const description = stripExistingBlock(activity.description ?? '');
    const combinedDescription = [description, block].filter(Boolean).join('\n\n');

    await updateActivityDescription(accessToken, activityId, combinedDescription);

    await saveAthleteMetrics({
      athleteId,
      activityId,
      activityDate: activity.start_date,
      pwHrDrift: metrics.pwHrDrift,
      rolling5Diff: metrics.rolling5Diff,
      power150Delta: metrics.power150Delta,
      z2Early: metrics.z2Early,
      z2Late: metrics.z2Late,
      cadenceDrop: metrics.cadenceDrop,
      hrCreep: metrics.hrCreep,
      context,
    });

    await markActivityProcessed({ athleteId, activityId });
  } catch (error) {
    console.error('Failed to process activity', error);
    throw error;
  }
}
