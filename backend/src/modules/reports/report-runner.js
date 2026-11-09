import { logger } from '../../utils/logger.js';
import { ABORT_REASONS } from './report-generation.js';

/** The runner has no free slot: the caller should retry later (HTTP 503). */
export class ReportBusyError extends Error {
  constructor() {
    super('Too many reports are being generated right now. Try again shortly.');
    this.name = 'ReportBusyError';
    this.code = 'REPORT_QUEUE_FULL';
  }
}

/**
 * Explicit, bounded, in-process worker for report generation (Feature 20).
 *
 * HTTP requests never wait for a report: they reserve a slot, create the pending report and return,
 * while the runner executes the job in the background with:
 *  - at most `maxConcurrent` jobs running and `maxQueued` waiting (more are refused up front, before
 *    any report is created),
 *  - a hard per-job deadline (`timeoutMs`) delivered as an AbortSignal (reason `timeout`),
 *  - orderly shutdown: running jobs are aborted (reason `shutdown`) and queued jobs are started
 *    already aborted so they record themselves as interrupted instead of staying `pending`.
 *
 * Limits are per process. This is deliberately not a distributed queue: if volume outgrows it, the
 * same `run` contract can move to a dedicated Railway worker (architecture.md).
 *
 * @param {{ maxConcurrent: number, maxQueued: number, timeoutMs: number }} options
 */
export function createReportRunner({ maxConcurrent, maxQueued, timeoutMs }) {
  const queue = [];
  const running = new Set();
  let reserved = 0;
  let stopped = false;
  let idleWaiters = [];

  const occupied = () => running.size + queue.length + reserved;

  function notifyIfIdle() {
    if (occupied() === 0 && idleWaiters.length > 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  function idle() {
    if (occupied() === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function execute(job, abortReason) {
    const controller = new AbortController();
    if (abortReason !== undefined) controller.abort(abortReason);
    const timer = setTimeout(() => controller.abort(ABORT_REASONS.TIMEOUT), timeoutMs);
    timer.unref?.();
    const entry = { controller };
    running.add(entry);
    Promise.resolve()
      .then(() => job(controller.signal))
      .catch((error) => {
        // Jobs record their own outcome and should never reject; this is a last-resort log.
        logger.error('Report job rejected unexpectedly', { errorName: error?.name });
      })
      .finally(() => {
        clearTimeout(timer);
        running.delete(entry);
        pump();
        notifyIfIdle();
      });
  }

  function pump() {
    while (!stopped && running.size < maxConcurrent && queue.length > 0) {
      execute(queue.shift());
    }
  }

  return Object.freeze({
    /**
     * Claims capacity synchronously. Throws {@link ReportBusyError} when full or stopped.
     * The caller must then call `run` (job) or `release` (nothing started).
     */
    reserve() {
      if (stopped || occupied() >= maxConcurrent + maxQueued) throw new ReportBusyError();
      reserved += 1;
      let used = false;
      const take = () => {
        if (used) throw new Error('A reserved slot can only be used once');
        used = true;
        reserved -= 1;
      };
      return Object.freeze({
        /** @param {(signal: AbortSignal) => Promise<unknown>} job */
        run(job) {
          take();
          if (stopped) {
            execute(job, ABORT_REASONS.SHUTDOWN);
          } else {
            queue.push(job);
            pump();
          }
        },
        release() {
          take();
          notifyIfIdle();
        },
      });
    },

    /** Current load, for diagnostics and tests. */
    stats: () => ({
      running: running.size,
      queued: queue.length,
      reserved,
      maxConcurrent,
      maxQueued,
      timeoutMs,
    }),

    /** Resolves when nothing is running, queued or reserved. */
    idle,

    /** Stops accepting work, aborts running jobs and lets queued ones record as interrupted. */
    async stop() {
      stopped = true;
      for (const entry of running) entry.controller.abort(ABORT_REASONS.SHUTDOWN);
      while (queue.length > 0) execute(queue.shift(), ABORT_REASONS.SHUTDOWN);
      await idle();
    },
  });
}
