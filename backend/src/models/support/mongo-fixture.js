import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

/**
 * Helpers for database integration tests. Every run uses a freshly named
 * database (simbisa_test_<random>) that is dropped afterwards, so tests never
 * touch application data. Base server: MONGODB_TEST_URI (host only, no
 * database name or query), default mongodb://127.0.0.1:27017.
 */
const TEST_DB_PREFIX = 'simbisa_test_';

export const TEST_MONGO_BASE_URI = (
  process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017'
).replace(/\/+$/, '');

/** True when a MongoDB server answers at the base URI. */
export async function isMongoReachable() {
  const connection = mongoose.createConnection(TEST_MONGO_BASE_URI, {
    serverSelectionTimeoutMS: 1500,
  });
  try {
    await connection.asPromise();
    return true;
  } catch {
    return false;
  } finally {
    await connection.close().catch(() => {});
  }
}

/** Skip reason for node:test when MongoDB is unavailable, otherwise false. */
export async function skipUnlessMongo() {
  return (await isMongoReachable())
    ? false
    : 'MongoDB not reachable at the test base URI; database integration tests skipped';
}

/** Creates a unique isolated database name and its connection config. */
export function createIsolatedDatabase() {
  const dbName = `${TEST_DB_PREFIX}${randomBytes(6).toString('hex')}`;
  return { dbName, config: { uri: `${TEST_MONGO_BASE_URI}/${dbName}` } };
}

/** Drops the isolated database. Refuses any name without the test prefix. */
export async function dropIsolatedDatabase(dbName) {
  if (!dbName.startsWith(TEST_DB_PREFIX) || mongoose.connection.name !== dbName) {
    throw new Error('Refusing to drop a database that is not the isolated test database');
  }
  await mongoose.connection.dropDatabase();
}
