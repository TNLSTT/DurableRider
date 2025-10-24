#!/usr/bin/env node
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { getValidToken, fetchActivity, updateActivityDescription } from '../lib/strava.js';

async function main() {
  const rl = readline.createInterface({ input, output });
  const athleteId = Number(process.argv[2]) || Number(await rl.question('Athlete ID: '));
  const activityId = Number(process.argv[3]) || Number(await rl.question('Activity ID: '));
  await rl.close();

  if (!athleteId || !activityId) {
    console.error('Athlete ID and Activity ID are required.');
    process.exit(1);
  }

  try {
    const { accessToken } = await getValidToken(athleteId);
    const activity = await fetchActivity(accessToken, activityId);
    console.log('Current description:\n', activity.description ?? '');
    const newDescription = `${activity.description ?? ''}\n\nManual test append @ ${new Date().toISOString()}`;
    await updateActivityDescription(accessToken, activityId, newDescription);
    console.log('Updated description successfully.');
  } catch (error) {
    console.error('Manual test failed', error);
  }
}

main();
