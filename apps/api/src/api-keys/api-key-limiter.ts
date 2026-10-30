export const KEY_LIMIT = 120;
export const KEY_WINDOW_SECONDS = 60;

export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface CounterRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export async function checkKeyLimit(redis: CounterRedis, keyId: string): Promise<LimitResult> {
  const bucket = `rl:apikey:${keyId}`;
  const count = await redis.incr(bucket);
  if (count === 1) {
    await redis.expire(bucket, KEY_WINDOW_SECONDS);
  }
  const ttl = await redis.ttl(bucket);
  return {
    allowed: count <= KEY_LIMIT,
    limit: KEY_LIMIT,
    remaining: Math.max(0, KEY_LIMIT - count),
    resetSeconds: ttl > 0 ? ttl : KEY_WINDOW_SECONDS,
  };
}
