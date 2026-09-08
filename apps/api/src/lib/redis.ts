import Redis from "ioredis";
import { config } from "../config";

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on("error", (error) => console.error("[redis]", error.message));

export async function connectRedis() {
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.ping();
    return true;
  } catch (error) {
    console.error("[redis] connection unavailable", error);
    return false;
  }
}
