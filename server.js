import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { Pool } from 'pg';
import qs from 'qs';

const app = express();
app.use(express.json());

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
} else {
  console.warn('DATABASE_URL not set. Database-backed features are disabled.');
}

async function ensureSchema() {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS athlete_tokens (
      athlete_id BIGINT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      scope TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/oauth/start', (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'Strava OAuth is not configured' });
    return;
  }

  const scope = 'activity:read_all,activity:write';
  const query = qs.stringify(
    {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      approval_prompt: 'auto',
      scope,
      state: req.query.state,
    },
    {
      arrayFormat: 'repeat',
      filter: (_prefix, value) => (value === undefined ? undefined : value),
    },
  );

  res.redirect(`https://www.strava.com/oauth/authorize?${query}`);
});

app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    res.status(400).json({ error: String(error) });
    return;
  }

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: 'Strava OAuth is not configured' });
    return;
  }

  try {
    const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    });

    if (!pool) {
      res.status(200).json({
        message: 'OAuth callback handled, but database is not configured. Tokens were not persisted.',
        data: tokenResponse.data,
      });
      return;
    }

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      athlete,
      scope,
    } = tokenResponse.data;

    if (!athlete || !athlete.id) {
      res.status(500).json({ error: 'Missing athlete information in Strava response' });
      return;
    }

    await pool.query(
      `INSERT INTO athlete_tokens (athlete_id, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES ($1, $2, $3, to_timestamp($4), $5, NOW())
       ON CONFLICT (athlete_id)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         updated_at = NOW()`,
      [athlete.id, accessToken, refreshToken, expiresAt, Array.isArray(scope) ? scope.join(',') : scope ?? ''],
    );

    res.json({
      message: 'OAuth tokens stored successfully',
      athlete: { id: athlete.id, firstname: athlete.firstname, lastname: athlete.lastname },
    });
  } catch (err) {
    console.error('Failed to handle OAuth callback', err);
    if (axios.isAxiosError?.(err)) {
      res.status(err.response?.status ?? 500).json({
        error: err.response?.data ?? err.message,
      });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

async function start() {
  try {
    await ensureSchema();
    app.listen(port, () => {
      console.log(`DurableRider server listening on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize application', error);
    process.exit(1);
  }
}

start();

export { app, pool };
