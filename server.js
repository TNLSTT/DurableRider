import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { Pool } from 'pg';
import qs from 'qs';
import http from 'http';

// ===============================
// Express + Core Setup
// ===============================
const app = express();
console.log('✅ Express initialized');

app.use(express.json({ limit: '1mb' }));

// Request logger — captures every request in real-time
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`➡️  [${req.method}] ${req.url} — Headers:`, req.headers);

  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`⬅️  [${req.method}] ${req.url} -> ${res.statusCode} (${ms}ms)`);
  });

  next();
});

// Capture low-level socket connections
app.on('connection', (socket) => {
  console.log(`🔌 New connection from ${socket.remoteAddress}`);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});

// ===============================
// Environment
// ===============================
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
console.log(`🔧 ENV loaded: PORT=${port}, DB=${process.env.DATABASE_URL ?? '(none)'}`);

// ===============================
// Database
// ===============================
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    console.log('🧠 Postgres pool created');
  } catch (err) {
    console.error('❌ Failed to initialize database pool:', err);
  }
} else {
  console.warn('⚠️ DATABASE_URL not set. Database features disabled.');
}

async function ensureSchema() {
  if (!pool) return;
  console.log('🧱 Ensuring DB schema...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS athlete_tokens (
      athlete_id BIGINT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      scope TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ DB schema ensured');
}

// ===============================
// Routes
// ===============================
app.get('/health', (req, res) => {
  console.log('🩺 /health route triggered');
  try {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Health route error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/oauth/start', (req, res) => {
  console.log('⚙️  /oauth/start triggered');
  try {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      res.status(500).json({ error: 'Strava OAuth not configured' });
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
      { arrayFormat: 'repeat' }
    );

    const redirect = `https://www.strava.com/oauth/authorize?${query}`;
    console.log(`🔗 Redirecting to: ${redirect}`);
    res.redirect(redirect);
  } catch (err) {
    console.error('❌ /oauth/start failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/oauth/callback', async (req, res) => {
  console.log('🔁 /oauth/callback triggered');
  const { code, error } = req.query;
  if (error) {
    console.error('⚠️  OAuth callback error param:', error);
    res.status(400).json({ error });
    return;
  }
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });
    console.log('✅ OAuth token exchange succeeded');

    if (!pool) {
      res.status(200).json({ message: 'DB not configured', data: tokenResponse.data });
      return;
    }

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      athlete,
      scope,
    } = tokenResponse.data;

    await pool.query(
      `INSERT INTO athlete_tokens (athlete_id, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES ($1,$2,$3,to_timestamp($4),$5,NOW())
       ON CONFLICT (athlete_id) DO UPDATE SET
         access_token=EXCLUDED.access_token,
         refresh_token=EXCLUDED.refresh_token,
         expires_at=EXCLUDED.expires_at,
         scope=EXCLUDED.scope,
         updated_at=NOW()`,
      [athlete.id, accessToken, refreshToken, expiresAt, Array.isArray(scope) ? scope.join(',') : scope ?? '']
    );

    console.log(`💾 Stored tokens for athlete ${athlete.id}`);
    res.json({ message: 'OAuth success', athlete });
  } catch (err) {
    console.error('❌ /oauth/callback failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/webhook', (req, res) => {
  console.log('🌐 /webhook GET verification hit', req.query);
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).json({ 'hub.challenge': challenge });
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Strava webhook event receiver (POST)
app.post('/webhook', async (req, res) => {
  console.log('📡 Received webhook event:', JSON.stringify(req.body, null, 2));
  res.status(200).send('EVENT_RECEIVED');

  try {
    if (req.body.aspect_type === 'create') {
      console.log(`Fetching details for ${req.body.object_id}...`);
      const tokenRes = await pool.query(
        'SELECT access_token FROM athlete_tokens WHERE athlete_id=$1',
        [req.body.owner_id]
      );
      const token = tokenRes.rows[0]?.access_token;
      if (token) {
        const activity = await axios.get(
          `https://www.strava.com/api/v3/activities/${req.body.object_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log('🏁 Activity:', activity.data.name, activity.data.distance);
      } else {
        console.warn(`⚠️ No access token found for athlete ${req.body.owner_id}`);
      }
    }
  } catch (err) {
    console.error('❌ Error processing webhook event:', err);
  }
});


// ===============================
// Startup
// ===============================
async function start() {
  console.log('🚦 Starting DurableRider...');

  const server = http.createServer(app);
  server.on('error', (err) => console.error('💥 HTTP server error:', err));
  server.on('connection', (socket) => {
    console.log(`🧩 New TCP socket from ${socket.remoteAddress}`);
    socket.on('error', (err) => console.error('⚠️ Socket error:', err));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server live at http://127.0.0.1:${port}`);
  });

  // Run DB schema creation async (non-blocking)
  if (pool) {
    ensureSchema().catch((err) => console.error('❌ Schema init failed:', err));
  }
}

start();
export { app, pool };
