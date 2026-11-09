import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import mongoose from 'mongoose';
import {
  DatabaseConfigError,
  DatabaseConnectionError,
  checkDatabaseReadiness,
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
  loadDatabaseConfig,
} from './database.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from '../models/support/mongo-fixture.js';

const SECRET = 'S3cretPassw0rd';
const URI_WITH_CREDENTIALS = `mongodb://appuser:${SECRET}@127.0.0.1:1/reports`;

describe('loadDatabaseConfig', () => {
  it('accepts mongodb:// and mongodb+srv:// URIs', () => {
    assert.equal(
      loadDatabaseConfig({ MONGODB_URI: 'mongodb://localhost:27017/x' }).uri,
      'mongodb://localhost:27017/x',
    );
    assert.equal(
      loadDatabaseConfig({ MONGODB_URI: ' mongodb+srv://u:p@cluster.example.net/x ' }).uri,
      'mongodb+srv://u:p@cluster.example.net/x',
    );
    assert.doesNotThrow(() =>
      loadDatabaseConfig({ MONGODB_URI: 'mongodb://a:1,b:2/x?replicaSet=r' }),
    );
  });

  it('rejects a missing or blank value', () => {
    assert.throws(() => loadDatabaseConfig({}), DatabaseConfigError);
    assert.throws(() => loadDatabaseConfig({ MONGODB_URI: '   ' }), /MONGODB_URI is required/);
  });

  it('rejects malformed values without echoing them', () => {
    for (const bad of [
      `http://user:${SECRET}@host/db`,
      `mongodb://`,
      `mongodb:///db`,
      `mongodb://user:${SECRET}@ho st/db`,
      `${SECRET}`,
    ]) {
      assert.throws(
        () => loadDatabaseConfig({ MONGODB_URI: bad }),
        (error) => {
          assert.ok(error instanceof DatabaseConfigError);
          assert.ok(!error.message.includes(SECRET), 'message must not contain the value');
          return true;
        },
        bad,
      );
    }
  });

  it('keeps the URI out of serialized config objects', () => {
    const config = loadDatabaseConfig({ MONGODB_URI: URI_WITH_CREDENTIALS });
    assert.ok(!JSON.stringify(config).includes(SECRET));
    assert.ok(!JSON.stringify({ config }).includes('appuser'));
    assert.ok(Object.isFrozen(config));
  });
});

describe('connection failure', () => {
  it('throws a sanitized error and logs no credentials', async () => {
    const logged = [];
    const capture = (line) => logged.push(String(line));
    const logSpy = mock.method(console, 'log', capture);
    const errorSpy = mock.method(console, 'error', capture);
    let thrown;
    try {
      await connectDatabase(loadDatabaseConfig({ MONGODB_URI: URI_WITH_CREDENTIALS }), {
        serverSelectionTimeoutMS: 500,
      });
    } catch (error) {
      thrown = error;
    } finally {
      logSpy.mock.restore();
      errorSpy.mock.restore();
    }

    assert.ok(thrown instanceof DatabaseConnectionError);
    assert.equal(thrown.message, 'Could not connect to MongoDB');
    assert.equal(thrown.cause, undefined);
    const everything = [thrown.message, thrown.stack, ...logged].join('\n');
    assert.ok(!everything.includes(SECRET), 'password leaked');
    assert.ok(!everything.includes('appuser'), 'username leaked');
    assert.ok(logged.some((line) => line.includes('MongoDB connection failed')));
    assert.equal(getDatabaseStatus(), 'disconnected');
  });

  it('reports not ready when disconnected', async () => {
    assert.deepEqual(await checkDatabaseReadiness(), { ready: false, state: 'disconnected' });
  });

  it('disconnect is safe when already disconnected', async () => {
    await assert.doesNotReject(disconnectDatabase());
  });
});

const skip = await skipUnlessMongo();

describe('connection lifecycle against MongoDB (isolated database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();
  const dbConfig = loadDatabaseConfig({ MONGODB_URI: config.uri });

  before(async () => {
    await connectDatabase(dbConfig);
  });

  after(async () => {
    if (getDatabaseStatus() === 'connected') {
      await dropIsolatedDatabase(dbName);
    }
    await disconnectDatabase();
  });

  it('connects and is ready', async () => {
    assert.equal(getDatabaseStatus(), 'connected');
    assert.equal(mongoose.connection.name, dbName);
    assert.deepEqual(await checkDatabaseReadiness(), { ready: true, state: 'connected' });
  });

  it('is idempotent when already connected', async () => {
    const connection = await connectDatabase(dbConfig);
    assert.equal(connection, mongoose.connection);
    assert.equal(getDatabaseStatus(), 'connected');
  });

  it('reports not ready after disconnect, and can reconnect', async () => {
    await disconnectDatabase();
    assert.deepEqual(await checkDatabaseReadiness(), { ready: false, state: 'disconnected' });
    await connectDatabase(dbConfig);
    assert.equal((await checkDatabaseReadiness()).ready, true);
  });
});
