import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';

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
