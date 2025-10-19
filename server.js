import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import qs from 'qs';

import { ensureSchema, deleteAthleteToken } from './lib/db.js';
import { upsertAthleteTokenFromOAuth } from './lib/strava.js';
import { processActivity } from './lib/activityProcessor.js';
import { initializeQueue, enqueueActivity, startQueueMonitor } from './lib/queue.js';
import { createTokenBucketMiddleware } from './lib/rateLimiter.js';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

if (process.env.WEBHOOK_PUBLIC_URL && !process.env.WEBHOOK_PUBLIC_URL.startsWith('https://')) {
  console.warn('WEBHOOK_PUBLIC_URL is not HTTPS. Configure HTTPS (e.g., via ngrok) for Strava webhooks.');
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const rateLimiter = createTokenBucketMiddleware();

app.get('/oauth/start', rateLimiter, (req, res) => {
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

app.get('/oauth/callback', rateLimiter, async (req, res) => {
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

    await upsertAthleteTokenFromOAuth({
      athleteId: athlete.id,
      accessToken,
      refreshToken,
      expiresAt,
      scope: Array.isArray(scope) ? scope.join(',') : scope ?? '',
    });

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

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    console.log('✅ Verified Strava webhook challenge');
    res.status(200).json({ 'hub.challenge': challenge });
  } else {
    console.log('❌ Failed webhook verification');
    res.sendStatus(403);
  }
});

app.post('/webhook', rateLimiter, async (req, res) => {
  const body = req.body;
  res.status(202).json({ received: true });

  if (!body) {
    return;
  }

  const { aspect_type: aspectType, object_type: objectType, object_id: activityId, owner_id: athleteId, updates } = body;

  if (updates?.authorized === 'false' && athleteId) {
    console.log(`Athlete ${athleteId} deauthorized. Deleting tokens.`);
    await deleteAthleteToken(athleteId);
    return;
  }

  if (objectType === 'activity' && (aspectType === 'create' || aspectType === 'update')) {
    if (!athleteId || !activityId) {
      console.warn('Webhook missing athlete or activity id', body);
      return;
    }

    try {
      await enqueueActivity({ athleteId: Number(athleteId), activityId: Number(activityId) });
    } catch (error) {
      console.error('Failed to enqueue activity', error);
    }
  }
});

app.use((err, req, res, _next) => {
  console.error('Request error', err);
  if (req.path === '/webhook') {
    console.error('ALERT: Webhook handler failed', err.message);
  }
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

app.get('/dashboard/:athleteId', async (req, res) => {
  const { athleteId } = req.params;
  try {
    const sinceDate = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
    const { loadBaselineMetrics } = await import('./lib/db.js');
    const metrics = await loadBaselineMetrics(Number(athleteId), sinceDate);
    res.send(`<!DOCTYPE html>
<html><head><title>Durability Dashboard</title></head>
<body>
<h1>Durability history for athlete ${athleteId}</h1>
<ul>
${metrics
  .map(
    (row) => `<li>${new Date(row.activity_date).toISOString()}: Pw:HR drift ${row.pw_hr_drift ?? 'n/a'}%, Rolling Δ ${row.rolling5_diff ?? 'n/a'}W</li>`,
  )
  .join('')}
</ul>
</body></html>`);
  } catch (error) {
    console.error('Failed to load dashboard', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

async function start() {
  try {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      throw new Error('TOKEN_ENCRYPTION_KEY must be configured for encrypted token storage.');
    }
    await ensureSchema();
    initializeQueue(processActivity);
    startQueueMonitor();
    app.listen(port, () => {
      console.log(`DurableRider server listening on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize application', error);
    process.exit(1);
  }
}

start();

export { app };
