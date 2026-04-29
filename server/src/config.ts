import Redis from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

const defaultConfig: RedisConfig = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

export function createRedis(config: RedisConfig = defaultConfig): Redis {
  return new Redis(config);
}
