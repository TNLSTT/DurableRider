const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function createBucket({ capacity, refillInterval, refillAmount }) {
  return {
    capacity,
    tokens: capacity,
    lastRefill: Date.now(),
    refillInterval,
    refillAmount,
  };
}

function refill(bucket) {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= bucket.refillInterval) {
    const increments = Math.floor(elapsed / bucket.refillInterval);
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + increments * bucket.refillAmount);
    bucket.lastRefill += increments * bucket.refillInterval;
  }
}

const shortBucket = createBucket({ capacity: 200, refillInterval: FIFTEEN_MINUTES, refillAmount: 200 });
const dailyBucket = createBucket({ capacity: 2000, refillInterval: ONE_DAY, refillAmount: 2000 });

function consumeToken() {
  refill(shortBucket);
  refill(dailyBucket);
  if (shortBucket.tokens <= 0 || dailyBucket.tokens <= 0) {
    return false;
  }
  shortBucket.tokens -= 1;
  dailyBucket.tokens -= 1;
  return true;
}

export function createTokenBucketMiddleware() {
  return function tokenBucketMiddleware(_req, res, next) {
    if (!consumeToken()) {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'Strava rate limit reached. Please retry later.' });
      return;
    }
    next();
  };
}

export function reserveTokenOrThrow() {
  if (!consumeToken()) {
    const error = new Error('Strava token bucket exhausted');
    error.status = 429;
    throw error;
  }
}
