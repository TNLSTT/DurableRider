import axios from 'axios';
import qs from 'qs';
import { deleteAthleteToken, getAthleteToken, upsertAthleteToken } from './db.js';
import { DEFAULT_PROFILE, resolveProfileKey } from './analysisProfiles/index.js';
import { reserveTokenOrThrow } from './rateLimiter.js';

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH_BASE = 'https://www.strava.com/oauth';
const DEFAULT_SCOPE = 'activity:read_all,activity:write';

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

function normalizeScope(scope) {
  if (!scope) {
    return DEFAULT_SCOPE;
  }

  if (Array.isArray(scope)) {
    return scope.join(',');
  }

  if (typeof scope === 'string') {
    const parts = scope
      .split(/[\s,]+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(',');
    }
  }

  return DEFAULT_SCOPE;
}

function normalizeExpiresAt(expiresAt) {
  if (expiresAt == null) {
    throw new Error('Strava OAuth response is missing expires_at.');
  }

  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return Math.floor(expiresAt);
  }

  const numeric = Number(expiresAt);
  if (Number.isFinite(numeric) && numeric > 1000000000) {
    return Math.floor(numeric);
  }

  const parsed = new Date(expiresAt);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) {
    throw new Error('Unable to parse Strava token expiration.');
  }
  return Math.floor(ms / 1000);
}

function normalizeOAuthTokenResponse(data) {
  const athleteId = data?.athlete?.id;
  if (!athleteId) {
    throw new Error('Strava OAuth response is missing athlete information.');
  }

  const normalizedScope = normalizeScope(data.scope);
  const expiresAt = normalizeExpiresAt(data.expires_at ?? data.expiresAt);

  return {
    athleteId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    scope: normalizedScope,
    athlete: data.athlete,
    raw: data,
  };
}

export function buildAuthorizationUrl({
  redirectUri = process.env.OAUTH_REDIRECT_URI,
  scope = DEFAULT_SCOPE,
  state,
  approvalPrompt = 'auto',
} = {}) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    throw new Error('STRAVA_CLIENT_ID is not configured.');
  }
  if (!redirectUri) {
    throw new Error('OAUTH_REDIRECT_URI is not configured.');
  }

  const query = {
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: approvalPrompt,
    scope: normalizeScope(scope),
  };

  if (state) {
    query.state = state;
  }

  const queryString = qs.stringify(query, { encode: true });
  return `${STRAVA_OAUTH_BASE}/authorize?${queryString}`;
}

export async function exchangeOAuthToken(code) {
  if (!code) {
    throw new Error('Authorization code is required to exchange Strava token.');
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Strava client credentials are not configured.');
  }

  const response = await axios.post(`${STRAVA_OAUTH_BASE}/token`, {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });

  return normalizeOAuthTokenResponse(response.data);
}

export async function upsertAthleteTokenFromOAuth(oauthData, { analysisProfile } = {}) {
  const resolvedProfile = resolveProfileKey(analysisProfile ?? oauthData.analysisProfile);
  await upsertAthleteToken({
    athleteId: oauthData.athleteId,
    accessToken: oauthData.accessToken,
    refreshToken: oauthData.refreshToken,
    expiresAt: oauthData.expiresAt,
    scope: oauthData.scope,
    analysisProfile: resolvedProfile,
  });

  return { ...oauthData, analysisProfile: resolvedProfile };
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

  const profileKey = token.analysisProfile ?? DEFAULT_PROFILE;
  const expiresAt = new Date(token.expiresAt).getTime();
  const now = Date.now();
  if (Number.isFinite(expiresAt) && expiresAt > now + 60 * 1000) {
    return { accessToken: token.accessToken, analysisProfile: profileKey };
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

    const normalized = normalizeOAuthTokenResponse(response.data);
    await upsertAthleteToken({
      athleteId,
      accessToken: normalized.accessToken,
      refreshToken: normalized.refreshToken,
      expiresAt: normalized.expiresAt,
      scope: normalized.scope,
      analysisProfile: token.analysisProfile ?? profileKey,
    });
    return { accessToken: normalized.accessToken, analysisProfile: token.analysisProfile ?? profileKey };
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
    'left_right_balance',
    'torque_effectiveness',
    'pedal_smoothness',
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
  const payload = qs.stringify({
    description: (description ?? '').slice(0, 2000),
  });

  const response = await axiosWithRetry({
    method: 'put',
    url: `${STRAVA_BASE}/activities/${activityId}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: payload,
  });
  return response.data;
}
