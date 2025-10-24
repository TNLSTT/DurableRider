import { Pool } from 'pg';
import { decrypt, encrypt } from './encryption.js';

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    })
  : null;

export function getPool() {
  if (!pool) {
    throw new Error('Database pool is not configured.');
  }

  return pool;
}

export async function ensureSchema() {
  if (!pool) {
    console.warn('DATABASE_URL not set. Database-backed features are disabled.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS athlete_tokens (
      athlete_id BIGINT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      scope TEXT NOT NULL,
      analysis_profile TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE athlete_tokens
    ADD COLUMN IF NOT EXISTS analysis_profile TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_cache (
      athlete_id BIGINT NOT NULL,
      activity_id BIGINT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, activity_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS athlete_metrics (
      athlete_id BIGINT NOT NULL,
      activity_id BIGINT NOT NULL,
      activity_date TIMESTAMPTZ NOT NULL,
      pw_hr_drift NUMERIC,
      rolling5_diff NUMERIC,
      power_150_delta NUMERIC,
      z2_early NUMERIC,
      z2_late NUMERIC,
      cadence_drop NUMERIC,
      hr_creep NUMERIC,
      chart_url TEXT,
      context JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, activity_id)
    )
  `);
}

export async function upsertAthleteToken({
  athleteId,
  accessToken,
  refreshToken,
  expiresAt,
  scope,
  analysisProfile,
}) {
  if (!pool) {
    throw new Error('Database pool unavailable for upsertAthleteToken.');
  }

  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = encrypt(refreshToken);
  await pool.query(
    `INSERT INTO athlete_tokens (athlete_id, access_token, refresh_token, expires_at, scope, analysis_profile, updated_at)
     VALUES ($1, $2, $3, to_timestamp($4), $5, $6, NOW())
     ON CONFLICT (athlete_id)
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       analysis_profile = COALESCE(EXCLUDED.analysis_profile, athlete_tokens.analysis_profile),
       updated_at = NOW()`,
    [athleteId, encryptedAccess, encryptedRefresh, expiresAt, scope ?? '', analysisProfile ?? null],
  );
}

export async function deleteAthleteToken(athleteId) {
  if (!pool) {
    return;
  }
  await pool.query('DELETE FROM athlete_tokens WHERE athlete_id = $1', [athleteId]);
}

export async function getAthleteToken(athleteId) {
  if (!pool) {
    throw new Error('Database pool unavailable for getAthleteToken.');
  }

  const result = await pool.query('SELECT * FROM athlete_tokens WHERE athlete_id = $1', [athleteId]);
  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    athleteId: row.athlete_id,
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: row.expires_at,
    scope: row.scope,
    analysisProfile: row.analysis_profile,
  };
}

export async function updateAthleteAnalysisProfile({ athleteId, analysisProfile }) {
  if (!pool) {
    throw new Error('Database pool unavailable for updateAthleteAnalysisProfile.');
  }

  await pool.query(
    `UPDATE athlete_tokens
     SET analysis_profile = $2, updated_at = NOW()
     WHERE athlete_id = $1`,
    [athleteId, analysisProfile ?? null],
  );
}

export async function getAthleteAnalysisProfile(athleteId) {
  if (!pool) {
    throw new Error('Database pool unavailable for getAthleteAnalysisProfile.');
  }

  const { rows } = await pool.query(
    'SELECT analysis_profile FROM athlete_tokens WHERE athlete_id = $1',
    [athleteId],
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0].analysis_profile ?? null;
}

export async function isActivityProcessed({ athleteId, activityId }) {
  if (!pool) {
    return false;
  }

  const { rowCount } = await pool.query(
    'SELECT 1 FROM activity_cache WHERE athlete_id = $1 AND activity_id = $2',
    [athleteId, activityId],
  );
  return rowCount > 0;
}

export async function markActivityProcessed({ athleteId, activityId }) {
  if (!pool) {
    return;
  }

  try {
    await pool.query(
      `INSERT INTO activity_cache (athlete_id, activity_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [athleteId, activityId],
    );
  } catch (error) {
    console.error('Failed to mark activity processed', error);
  }
}

export async function saveAthleteMetrics({
  athleteId,
  activityId,
  activityDate,
  pwHrDrift,
  rolling5Diff,
  power150Delta,
  z2Early,
  z2Late,
  cadenceDrop,
  hrCreep,
  chartUrl = null,
  context,
}) {
  if (!pool) {
    return;
  }

  await pool.query(
    `INSERT INTO athlete_metrics (
      athlete_id,
      activity_id,
      activity_date,
      pw_hr_drift,
      rolling5_diff,
      power_150_delta,
      z2_early,
      z2_late,
      cadence_drop,
      hr_creep,
      chart_url,
      context
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (athlete_id, activity_id)
    DO UPDATE SET
      pw_hr_drift = EXCLUDED.pw_hr_drift,
      rolling5_diff = EXCLUDED.rolling5_diff,
      power_150_delta = EXCLUDED.power_150_delta,
      z2_early = EXCLUDED.z2_early,
      z2_late = EXCLUDED.z2_late,
      cadence_drop = EXCLUDED.cadence_drop,
      hr_creep = EXCLUDED.hr_creep,
      chart_url = EXCLUDED.chart_url,
      context = EXCLUDED.context`,
    [
      athleteId,
      activityId,
      activityDate,
      pwHrDrift,
      rolling5Diff,
      power150Delta,
      z2Early,
      z2Late,
      cadenceDrop,
      hrCreep,
      chartUrl ?? null,
      context ? JSON.stringify(context) : null,
    ],
  );
}

export async function loadBaselineMetrics(athleteId, sinceDate) {
  if (!pool) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT * FROM athlete_metrics WHERE athlete_id = $1 AND activity_date >= $2 ORDER BY activity_date DESC`,
    [athleteId, sinceDate],
  );
  return rows;
}
