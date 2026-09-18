import Redis from 'ioredis';
import { EventEmitter } from 'events';

const REDIS_URL = process.env.REDIS_URL;

class MockRedis extends EventEmitter {
  constructor() {
    super();
    this.sets = new Map();
    this.kv = new Map();
  }
  async get(key) {
    return this.kv.get(key) || null;
  }
  async set(key, value) {
    this.kv.set(key, value);
    return 'OK';
  }
  async sismember(key, member) {
    const s = this.sets.get(key);
    return s && s.has(member) ? 1 : 0;
  }
  async sadd(key, member) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key).add(member);
    return 1;
  }
  async expire() {
    return 1;
  }
  async publish(channel, message) {
    if (globalThis.__mockRedisEmitter) {
      globalThis.__mockRedisEmitter.emit('message', channel, message);
    }
    return 1;
  }
  subscribe(channel, cb) {
    if (!globalThis.__mockRedisEmitter) {
      globalThis.__mockRedisEmitter = new EventEmitter();
    }
    globalThis.__mockRedisEmitter.on('message', (ch, msg) => {
      if (ch === channel) {
        this.emit('message', ch, msg);
      }
    });
    if (cb) cb(null);
    return Promise.resolve();
  }
}

let redis, redisPublisher, redisSubscriber;

if (REDIS_URL) {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  redisPublisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  redisSubscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

  redis.on('error', (err) => console.warn('[Redis Error]', err.message));
  redisPublisher.on('error', (err) => console.warn('[Redis Publisher Error]', err.message));
  redisSubscriber.on('error', (err) => console.warn('[Redis Subscriber Error]', err.message));
} else {
  console.warn('[Redis] REDIS_URL not set — using resilient in-memory fallback for local dev/testing.');
  redis = new MockRedis();
  redisPublisher = redis;
  redisSubscriber = redis;
}

export { redis, redisPublisher, redisSubscriber };

