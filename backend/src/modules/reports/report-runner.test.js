import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ABORT_REASONS } from './report-generation.js';
import { ReportBusyError, createReportRunner } from './report-runner.js';

/** A job that stays running until `finish()` is called, recording its abort reason. */
function controllableJob() {
  let finish;
  const state = { started: false, reason: undefined };
  const job = (signal) =>
    new Promise((resolve) => {
      state.started = true;
      finish = resolve;
      signal.addEventListener('abort', () => {
        state.reason = signal.reason;
        resolve();
      });
      if (signal.aborted) {
        state.reason = signal.reason;
        resolve();
      }
    });
  return { job, state, finish: () => finish() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('report runner', () => {
  it('runs at most maxConcurrent jobs and starts queued ones as slots free up', async () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 60_000 });
    const a = controllableJob();
    const b = controllableJob();
    runner.reserve().run(a.job);
    runner.reserve().run(b.job);
    await tick();
    assert.equal(a.state.started, true);
    assert.equal(b.state.started, false);
    assert.deepEqual(
      { running: runner.stats().running, queued: runner.stats().queued },
      { running: 1, queued: 1 },
    );
    a.finish();
    await tick();
    assert.equal(b.state.started, true);
    b.finish();
    await runner.idle();
    assert.equal(runner.stats().running + runner.stats().queued, 0);
  });

  it('refuses work beyond running + queued, synchronously, and frees capacity on release', async () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 60_000 });
    const a = controllableJob();
    const b = controllableJob();
    runner.reserve().run(a.job);
    runner.reserve().run(b.job);
    assert.throws(() => runner.reserve(), ReportBusyError);
    await tick();
    a.finish();
    await tick();
    const slot = runner.reserve(); // capacity is back
    slot.release(); // nothing started: capacity returns again
    assert.equal(runner.stats().reserved, 0);
    b.finish();
    await runner.idle();
  });

  it('a reserved slot counts against capacity until it is used or released', () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 0, timeoutMs: 60_000 });
    const slot = runner.reserve();
    assert.throws(() => runner.reserve(), ReportBusyError);
    slot.release();
    assert.doesNotThrow(() => runner.reserve().release());
    assert.throws(() => slot.release(), /only be used once/);
  });

  it('aborts a job that exceeds the deadline with reason "timeout"', async () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 0, timeoutMs: 20 });
    const a = controllableJob();
    runner.reserve().run(a.job);
    // The runner's deadline timer is unref'd (it must not keep a server alive); hold the loop open.
    const keepAlive = setTimeout(() => {}, 5000);
    await runner.idle();
    clearTimeout(keepAlive);
    assert.equal(a.state.reason, ABORT_REASONS.TIMEOUT);
  });

  it('keeps running after a job that rejects', async () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 60_000 });
    let ran = false;
    runner.reserve().run(() => Promise.reject(new Error('boom')));
    runner.reserve().run(async () => {
      ran = true;
    });
    await runner.idle();
    assert.equal(ran, true);
  });

  it('stop() aborts running jobs, hands queued jobs an aborted signal and refuses new work', async () => {
    const runner = createReportRunner({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 60_000 });
    const running = controllableJob();
    const queued = controllableJob();
    runner.reserve().run(running.job);
    runner.reserve().run(queued.job);
    await tick();
    await runner.stop();
    assert.equal(running.state.reason, ABORT_REASONS.SHUTDOWN);
    assert.equal(queued.state.reason, ABORT_REASONS.SHUTDOWN);
    assert.throws(() => runner.reserve(), ReportBusyError);
  });
});
