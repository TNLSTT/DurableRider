import axios from 'axios';
import qs from 'qs';
import { deleteAthleteToken, getAthleteToken, upsertAthleteToken } from './db.js';
import { reserveTokenOrThrow } from './rateLimiter.js';

const STRAVA_BASE = 'https://www.strava.com/api/v3';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt) {
  const base = 5 * 60 * 1000; // 5 minutes
  const delay = base * 2 ** (attempt - 1);
  return Math.min(delay, 10 * 60 * 1000);
}

export async function axiosWithRetry(config, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      reserveTokenOrThrow();
      console.log('Strava API request', {
        method: config.method ?? 'get',
        url: config.url,
        attempt,
      });
      return await axios(config);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < attempts) {
        const delay = computeBackoff(attempt);
        console.warn(
          `Strava rate limit hit (attempt ${attempt}/${attempts}). Retrying after ${Math.round(delay / 60000)} minutes.`,
        );
        await wait(delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error('axiosWithRetry exhausted attempts');
}

export async function upsertAthleteTokenFromOAuth(data) {
  await upsertAthleteToken(data);
}

export async function getValidToken(athleteId) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Strava client credentials are not configured.');
  }

  const token = await getAthleteToken(athleteId);
  if (!token) {
    throw new Error(`No token stored for athlete ${athleteId}`);
  }

  const expiresAt = new Date(token.expiresAt).getTime();
  const now = Date.now();
  if (Number.isFinite(expiresAt) && expiresAt > now + 60 * 1000) {
    return token.accessToken;
  }

  try {
    const response = await axiosWithRetry({
      method: 'post',
      url: 'https://www.strava.com/oauth/token',
      data: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      },
    });

    const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAtSeconds, scope } = response.data;
    await upsertAthleteToken({
      athleteId,
      accessToken,
      refreshToken,
      expiresAt: expiresAtSeconds,
      scope,
    });
    return accessToken;
  } catch (error) {
    console.error('Failed to refresh Strava token', error);
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      console.warn('Deleting athlete token due to refresh failure.');
      await deleteAthleteToken(athleteId);
    }
    throw error;
  }
}

export async function fetchActivity(accessToken, activityId) {
  const url = `${STRAVA_BASE}/activities/${activityId}`;
  const response = await axiosWithRetry({
    method: 'get',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { include_all_efforts: false },
  });
  return response.data;
}

export async function fetchStreams(accessToken, activityId) {
  const keys = [
    'watts',
    'heartrate',
    'time',
    'distance',
    'altitude',
    'velocity_smooth',
    'cadence',
  ];
  const response = await axiosWithRetry({
    method: 'get',
    url: `${STRAVA_BASE}/activities/${activityId}/streams`,
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { keys: keys.join(','), key_by_type: true },
    paramsSerializer: (params) =>
      qs.stringify(params, {
        encode: true,
        arrayFormat: 'repeat',
      }),
  });
  return response.data;
}

export async function updateActivityDescription(accessToken, activityId, description) {
  const response = await axiosWithRetry({
    method: 'put',
    url: `${STRAVA_BASE}/activities/${activityId}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { description },
  });
  return response.data;
}
