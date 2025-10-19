import PQueue from 'p-queue';
import { Queue, Worker, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';

let queue = null;
let usingRedis = false;
let inMemoryQueue = null;
let processorRef = null;
let redisConnection = null;

export function initializeQueue(processor) {
  if (queue) {
    return;
  }

  processorRef = processor;

  if (process.env.REDIS_URL) {
    redisConnection = new IORedis(process.env.REDIS_URL, { lazyConnect: true });
    queue = new Queue('durability-activities', { connection: redisConnection });
    new QueueScheduler('durability-activities', { connection: redisConnection });
    new Worker(
      'durability-activities',
      async (job) => {
        await processor(job.data);
      },
      { connection: redisConnection },
    );
    usingRedis = true;
    console.log('Initialized BullMQ queue for activity processing.');
  } else {
    inMemoryQueue = new PQueue({ concurrency: Number.parseInt(process.env.PROCESS_CONCURRENCY ?? '1', 10) });
    console.log('Initialized in-memory queue for activity processing.');
  }
}

export async function enqueueActivity(data) {
  if (!queue && !inMemoryQueue) {
    throw new Error('Queue not initialized.');
  }

  if (usingRedis) {
    await queue.add('activity', data, { removeOnComplete: true, attempts: 3 });
  } else {
    await inMemoryQueue.add(() => processorRef(data));
  }
}

export async function getQueueSize() {
  if (usingRedis && queue) {
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    return counts.waiting + counts.delayed;
  }
  if (inMemoryQueue) {
    return inMemoryQueue.size;
  }
  return 0;
}

export function startQueueMonitor() {
  const threshold = Number.parseInt(process.env.QUEUE_ALERT_THRESHOLD ?? '25', 10);
  setInterval(async () => {
    try {
      const size = await getQueueSize();
      if (size > threshold) {
        console.error(`ALERT: Queue backlog at ${size} tasks (threshold ${threshold}).`);
      }
    } catch (error) {
      console.error('Failed to monitor queue size', error);
    }
  }, 60 * 1000);
}
