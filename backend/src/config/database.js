import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5000;
// Scheme plus at least one host. Credentials may be embedded, so this module
// never echoes the URI (or any part of it) in errors or logs.
const MONGODB_URI_PATTERN = /^mongodb(\+srv)?:\/\/[^\s/]+(\/\S*)?$/;

const READY_STATES = Object.freeze({
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
});

/** Thrown for a missing or malformed MONGODB_URI. The message never contains the value. */
export class DatabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/** Thrown when connecting fails. Carries no driver message, since it may name hosts or users. */
export class DatabaseConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConnectionError';
  }
}

/**
 * @typedef {object} DatabaseConfig
 * @property {string} uri MongoDB connection string. Treat as a secret.
 */

/**
 * Reads and validates MONGODB_URI. Throws a DatabaseConfigError without
 * including the value, so credentials cannot leak through startup logs.
 * @param {NodeJS.ProcessEnv} env
 * @returns {DatabaseConfig}
 */
export function loadDatabaseConfig(env = process.env) {
  const uri = env.MONGODB_URI?.trim();
  if (uri === undefined || uri === '') {
    throw new DatabaseConfigError('MONGODB_URI is required');
  }
  if (!MONGODB_URI_PATTERN.test(uri)) {
    throw new DatabaseConfigError(
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string',
    );
  }
  // Non-enumerable so JSON.stringify / logging a config object cannot print it.
  const config = {};
  Object.defineProperty(config, 'uri', { value: uri, enumerable: false });
  return Object.freeze(config);
}

/**
 * Returns the connection state name: connected, connecting, disconnecting or disconnected.
 * @param {import('mongoose').Connection} [connection]
 */
export function getDatabaseStatus(connection = mongoose.connection) {
  return READY_STATES[connection.readyState] ?? 'disconnected';
}

/**
 * Readiness check: the connection is open AND the server answers a ping.
 * Never throws and never includes driver error text.
 * @param {import('mongoose').Connection} [connection]
 * @returns {Promise<{ ready: boolean, state: string }>}
 */
export async function checkDatabaseReadiness(connection = mongoose.connection) {
  const state = getDatabaseStatus(connection);
  if (state !== 'connected') {
    return { ready: false, state };
  }
  try {
    await connection.db.admin().ping();
    return { ready: true, state };
  } catch {
    return { ready: false, state };
  }
}

let eventLoggingRegistered = false;

function registerConnectionEventLogging(connection) {
  if (eventLoggingRegistered) {
    return;
  }
  eventLoggingRegistered = true;
  connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  // Log the error class only; driver messages can include connection details.
  connection.on('error', (error) =>
    logger.error('MongoDB connection error', { errorName: error?.name }),
  );
}

/**
 * Opens the default Mongoose connection. Index creation is explicit
 * (see ensureModelIndexes) so production never builds indexes implicitly.
 * @param {DatabaseConfig} config
 * @param {{ serverSelectionTimeoutMS?: number }} [options]
 * @returns {Promise<import('mongoose').Connection>}
 */
export async function connectDatabase(config, options = {}) {
  if (getDatabaseStatus() === 'connected') {
    return mongoose.connection;
  }
  registerConnectionEventLogging(mongoose.connection);
  try {
    await mongoose.connect(config.uri, {
      autoIndex: false,
      serverSelectionTimeoutMS:
        options.serverSelectionTimeoutMS ?? DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    });
  } catch (error) {
    logger.error('MongoDB connection failed', { errorName: error?.name });
    await mongoose.disconnect().catch(() => {});
    throw new DatabaseConnectionError('Could not connect to MongoDB');
  }
  logger.info('MongoDB connected', { database: mongoose.connection.name });
  return mongoose.connection;
}

/** Closes the default connection. Safe to call when already disconnected. */
export async function disconnectDatabase() {
  if (getDatabaseStatus() === 'disconnected') {
    return;
  }
  await mongoose.disconnect();
}
