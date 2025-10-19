#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

const payload = {
  aspect_type: 'create',
  object_type: 'activity',
  object_id: Number(process.argv[2] ?? 0) || 1234567890,
  owner_id: Number(process.argv[3] ?? 0) || 987654321,
};

axios
  .post(`http://localhost:${port}/webhook`, payload)
  .then((response) => {
    console.log('Webhook simulated:', response.data);
  })
  .catch((error) => {
    console.error('Simulation failed', error.response?.data ?? error.message);
  });
