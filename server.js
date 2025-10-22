import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema as ensureDbSchema, deleteAthleteToken } from './lib/db.js';
import { initializeQueue, enqueueActivity, startQueueMonitor } from './lib/queue.js';
import { processActivity } from './lib/activityProcessor.js';
import {
  buildAuthorizationUrl,
  exchangeOAuthToken,
  upsertAthleteTokenFromOAuth,
} from './lib/strava.js';

// ===============================
// Express + Core Setup
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.use(express.static(path.join(__dirname, 'public')));

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

const dbConfigured = Boolean(process.env.DATABASE_URL);
if (!dbConfigured) {
  console.warn('⚠️ DATABASE_URL not set. Database-backed durability features disabled.');
}

initializeQueue(processActivity);
startQueueMonitor();

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
    const redirect = buildAuthorizationUrl({
      redirectUri: process.env.OAUTH_REDIRECT_URI,
      state: req.query.state,
      scope: req.query.scope,
    });
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
    const oauthData = await exchangeOAuthToken(code);
    console.log('✅ OAuth token exchange succeeded');

    if (!dbConfigured) {
      console.warn('⚠️ OAuth succeeded but DATABASE_URL is not configured. Tokens not persisted.');
      res.status(200).json({ message: 'OAuth success (tokens not persisted)', athlete: oauthData.athlete });
      return;
    }

    try {
      await upsertAthleteTokenFromOAuth(oauthData);
      console.log(`💾 Stored tokens for athlete ${oauthData.athleteId}`);
      res.json({ message: 'OAuth success', athlete: oauthData.athlete });
    } catch (dbError) {
      console.error('❌ Failed to persist OAuth tokens:', dbError);
      res.status(500).json({ error: 'Failed to persist tokens. Please try again later.' });
    }
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
    const event = req.body;

    if (event.object_type === 'activity' && (event.aspect_type === 'create' || event.aspect_type === 'update')) {
      if (!dbConfigured) {
        console.warn('⚠️ Received activity event but DATABASE_URL is not configured. Skipping durability processing.');
        return;
      }

      await enqueueActivity({ athleteId: event.owner_id, activityId: event.object_id });
      console.log(`📬 Activity ${event.object_id} for athlete ${event.owner_id} enqueued for durability analysis.`);
    }

    if (event.object_type === 'athlete' && event.aspect_type === 'update' && event.updates?.authorized === 'false') {
      if (!dbConfigured) {
        return;
      }
      await deleteAthleteToken(event.owner_id);
      console.log(`🧹 Revoked tokens for athlete ${event.owner_id} after deauthorization.`);
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
  if (dbConfigured) {
    ensureDbSchema().catch((err) => console.error('❌ Schema init failed:', err));
  }
}

start();
export { app };
