import 'dotenv/config';
import express from 'express';
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
