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
import { DEFAULT_PROFILE, getAllMarkers, getRenderer } from './analysisProfiles/index.js';

const LEGACY_MARKERS = ['<!-- durability-post v0.1 -->', '<!-- durability-post -->'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
}

function stripExistingBlock(description) {
  if (!description) {
    return '';
  }
  const markers = [...getAllMarkers(), ...LEGACY_MARKERS];
  return markers
    .reduce((text, marker) => {
      const regex = new RegExp(`${escapeRegExp(marker)}[\s\S]*?$`, 'm');
      return text.replace(regex, '').trim();
    }, description)
    .trim();
}

export async function processActivity({ athleteId, activityId }) {
  const alreadyProcessed = await isActivityProcessed({ athleteId, activityId });
  if (alreadyProcessed) {
    console.log(`Skipping activity ${activityId} for athlete ${athleteId} — already processed.`);
    return;
  }

  try {
    const { accessToken, analysisProfile } = await getValidToken(athleteId);
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

    const cadenceSummary = summarizeCadenceFatigue(
      metrics.cadenceDrop,
      metrics.hrCreep,
      metrics.cadenceStability,
    );

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

    const profileKey = analysisProfile ?? DEFAULT_PROFILE;
    const renderer = getRenderer(profileKey);
    const block = await renderer.render({
      metrics,
      baseline,
      hrr,
      cadenceSummary,
      context,
      activity,
      history,
      athleteId,
    });

    console.log('Durability metrics', {
      athleteId,
      activityId,
      metrics,
      baseline,
      hrr,
      cadenceSummary,
      profileKey,
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
