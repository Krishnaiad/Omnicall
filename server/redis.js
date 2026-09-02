import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error('[FATAL] REDIS_URL environment variable is not set.');
}

// Main redis connection
export const redis = new Redis(REDIS_URL);

// Publishers and Subscribers need separate connections
export const redisPublisher = new Redis(REDIS_URL);
export const redisSubscriber = new Redis(REDIS_URL);

redis.on('error', (err) => console.error('[Redis Error]', err));
redisPublisher.on('error', (err) => console.error('[Redis Publisher Error]', err));
redisSubscriber.on('error', (err) => console.error('[Redis Subscriber Error]', err));
