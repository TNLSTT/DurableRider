
# Durability-Post — Development TODO - Assume Not Done unless [DONE] is printed on the line

## 1. Core Setup [DONE]
- Initialize a new Node.js project with Express, Axios, QS, and PG dependencies. [DONE]
- Create `.env` with all required keys: PORT, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN, OAUTH_REDIRECT_URI, DATABASE_URL. [DONE]
- Add a `server.js` entry point using ES modules syntax (`type: module` in package.json). [DONE]
- Connect to Postgres via `pg` Pool and auto-create the `athlete_tokens` table if missing. [DONE]

## 2. OAuth Integration
- Implement `/oauth/start` endpoint that redirects user to Strava’s authorization URL with scopes `activity:read_all,activity:write`. [DONE]
  - Resolution: Added Express route building the Strava authorize URL from environment configuration and redirecting requests.
- Implement `/oauth/callback` endpoint that exchanges the `code` for tokens and saves athlete info in Postgres. [DONE]
  - Resolution: Added Express handler exchanging Strava authorization codes, persisting tokens via upsert into `athlete_tokens`, and returning athlete summary.
- Write helper `upsertAthleteToken()` to insert or update tokens with expiry handling.  
- Write helper `getValidToken()` that refreshes the Strava token automatically if expired.  

## 3. Webhook Subscription & Handling
- Implement `/webhook` GET endpoint to verify Strava challenge by returning `hub.challenge`.  
- Implement `/webhook` POST endpoint to handle events for `activity.create` and `activity.update`.  
- Add logic to delete tokens on athlete deauthorization (`authorized=false`).  
- Write `processActivity(athlete_id, activity_id)` to enqueue or directly process activity analysis.  
- Create admin shell script to register webhook subscription via `POST /api/v3/push_subscriptions`.  

## 4. Activity Processing Pipeline
- Fetch streams for keys `watts,heartrate,time,distance,altitude,velocity_smooth,cadence` using Strava API with `key_by_type=true`.  
- Validate and clean data: clamp HR 40–220 bpm, power 0–2000 W, remove nulls.  
- Split arrays into equal halves (or terciles if <60 min).  
- Compute Pw:HR drift as percent change in (mean power / mean HR) from early → late.  
- Compute best rolling 5-minute power early vs late and calculate delta watts.  
- Compute mean power at 150 bpm (± 2.5 bpm) early vs late and calculate delta.  
- Compute Z2 share (120–150 bpm) early vs late and express as percentages.  
- Combine all metrics into formatted text block with marker `<!-- durability-post v0.1 -->`.  

## 5. Activity Update
- Fetch the current activity description via Strava API.  
- Strip any existing durability block using regex matching your signature marker.  
- Append the new analysis text to the end of the description.  
- PATCH the updated description using `PUT /api/v3/activities/{id}` with bearer token.  
- Handle missing data gracefully (e.g., “No HR data — skipped”).  

## 6. Error & Rate-Limit Handling
- Catch and log all Axios errors with status and message.  
- Detect HTTP 429 responses and retry after exponential backoff (5–10 min).  
- Implement deduplication and idempotency using an `activity_cache` table with `(athlete_id, activity_id)` primary key.  
- Respect Strava API rate limits (200 req/15 min, 2000/day; 100/15 min non-upload).  

## 7. Security & Cleanup
- Delete athlete tokens when receiving deauthorization webhook events.  
- Store tokens encrypted using environment-level secret or KMS if available.  
- Never overwrite user-written text — always append your block safely.  
- Ensure HTTPS for webhook callback (use ngrok for local testing).  

## 8. Testing & Validation
- Add manual test script to fetch and patch a known activity for local debugging.  
- Simulate webhook POST events with local JSON payloads to verify end-to-end flow.  
- Log computed metrics to console for verification before writing to Strava.  

## 9. v1.1 Enhancements
- Replace HR absolute bands with HRR-based Z2 calculation using athlete max/resting HR.  
- Compute “durability baseline” per athlete from last 8 weeks and compare today’s ride.  
- Add cadence-based fatigue detection (drop + HR creep).  
- Host PNG chart (early vs late watts@HR) on S3 and include link in description.  
- Create a small web dashboard to show durability history per athlete.  
- Support indoor vs outdoor tagging and context (heat/altitude).  
- Add Redis or worker queue for scalable background job handling.  
- Add token bucket middleware to centralize rate-limit enforcement.  

## 10. Deployment & Monitoring
- Deploy to Fly.io, Render, or small VPS with persistent Postgres.  
- Add logging middleware for all incoming requests and API calls.  
- Add health check endpoint at `/health`.  
- Set up alerts for webhook 5xx errors and queue backlog growth.  
