import Redis from "ioredis";
export const redis = new Redis();

export const insertData = async (key, value) => {
  if (typeof value === "object") {
    await redis.hset(key, value);
  } else if (typeof value === "string") {
    await redis.set(key, value);
  }
};

export const getStringData = async (key, type) => {
  try {
    return await redis.get(key);
  } catch (error) {
    console.error(error.messge);
  }
};

export const deleteStringData = async (key) => {
  try {
    const data = await redis.get(key);
    await redis.del(key);
    return data;
  } catch (error) {
    console.error(error.messge);
  }
};

export const getHashData = async (key, property) => {
  if (!property) {
    return await redis.hgetall(key);
  }
  return await redis.hget(key, property);
};
