import Redis from "ioredis";
const redis = new Redis();

export const insertData = async (key, value) => {
  await redis.set(key, value);
};

export const getData = async (key) => {
  try {
    return await redis.get(key);
  } catch (error) {
    console.error(error.messge);
  }
};

export const deleteData = async (key) => {
  try {
    const data = await redis.get(key);
    return data;
  } catch (error) {
    console.error(error.messge);
  }
};
