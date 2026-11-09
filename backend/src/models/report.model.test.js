import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Report, ReportImmutableError, REPORT_SCHEMA_VERSION } from './report.model.js';
import { ensureModelIndexes } from './index.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from './support/mongo-fixture.js';

const NOW = new Date('2026-11-07T10:00:00Z');

function pendingReport(overrides = {}) {
  return {
    filters: { startDate: '20261101', endDate: '20261107', productIds: ['P1'] },
    provenance: { source: 'GAAP_UNITY' },
    ...overrides,
  };
}

function completedReport(overrides = {}) {
  return pendingReport({
    status: 'completed',
    completedAt: NOW,
    rowCount: 2,
    integrity: { rowsChecksum: 'a'.repeat(64), verifiedAt: NOW },
    provenance: { source: 'GAAP_UNITY', fetchedAt: NOW, complete: true },
    totals: [
      { currency: 'USD', lineCount: 1, quantity: '2', turnover: '10.50' },
      { currency: 'ZWG', lineCount: 1, quantity: '1', turnover: '300' },
    ],
    ...overrides,
  });
}

async function errorsFor(data) {
  const error = await new Report(data).validate().then(
    () => null,
    (e) => e,
  );
  return error ? Object.keys(error.errors) : [];
}

describe('Report validation', () => {
  it('accepts a minimal pending report and applies defaults', async () => {
    const report = new Report(pendingReport());
    await report.validate();
    assert.equal(report.status, 'pending');
    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(report.provenance.usedCache, false);
    assert.equal(report.provenance.complete, false);
    assert.deepEqual([...report.totals], []);
  });

  it('accepts a consistent completed report with per-currency totals', async () => {
    await new Report(completedReport()).validate();
  });

  it('rejects a missing filters block, provenance or bad status', async () => {
    assert.ok((await errorsFor({ provenance: { source: 'GAAP_UNITY' } })).includes('filters'));
    assert.ok((await errorsFor({ filters: pendingReport().filters })).includes('provenance'));
    assert.ok((await errorsFor(pendingReport({ status: 'done' }))).includes('status'));
    assert.ok(
      (await errorsFor(pendingReport({ provenance: { source: 'OTHER' } }))).includes(
        'provenance.source',
      ),
    );
  });

  it('rejects invalid or reversed dates', async () => {
    const bad = (filters) => errorsFor(pendingReport({ filters }));
    assert.ok(
      (await bad({ startDate: '20260231', endDate: '20260301' })).includes('filters.startDate'),
    );
    assert.ok(
      (await bad({ startDate: '07/11/2026', endDate: '20261107' })).includes('filters.startDate'),
    );
    assert.ok(
      (await bad({ startDate: '20261108', endDate: '20261107' })).includes('filters.endDate'),
    );
    assert.ok((await bad({ startDate: '20261107' })).includes('filters.endDate'));
    // The old dashed format is no longer the stored format.
    assert.ok(
      (await bad({ startDate: '2026-11-01', endDate: '2026-11-07' })).includes('filters.startDate'),
    );
    assert.ok(
      (await bad({ startDate: '20261101', endDate: '2026-11-07' })).includes('filters.endDate'),
    );
  });

  it('allows a single-day range', async () => {
    await new Report(
      pendingReport({ filters: { startDate: '20261107', endDate: '20261107' } }),
    ).validate();
  });

  it('never defaults a missing currency and keeps UNKNOWN distinct', async () => {
    const total = { lineCount: 1, quantity: '1', turnover: '1' };
    const missing = await errorsFor(completedReport({ totals: [total] }));
    assert.ok(
      missing.some((path) => path.endsWith('currency')),
      'missing currency must fail',
    );

    await new Report(completedReport({ totals: [{ ...total, currency: 'UNKNOWN' }] })).validate();

    for (const currency of ['usd', 'US', 'DOLLARS', 'Unknown']) {
      const errs = await errorsFor(completedReport({ totals: [{ ...total, currency }] }));
      assert.ok(
        errs.some((path) => path.endsWith('currency')),
        `${currency} should be rejected`,
      );
    }
  });

  it('rejects duplicate currency entries so currencies are never merged', async () => {
    const entry = { currency: 'USD', lineCount: 1, quantity: '1', turnover: '1' };
    assert.ok((await errorsFor(completedReport({ totals: [entry, entry] }))).includes('totals'));
  });

  it('keeps zero, missing and invalid amounts distinguishable', async () => {
    const base = { currency: 'USD', lineCount: 0 };
    await new Report(
      completedReport({ totals: [{ ...base, quantity: '0', turnover: '0' }] }),
    ).validate();

    const errs = await errorsFor(completedReport({ totals: [{ ...base, quantity: '0' }] }));
    assert.ok(
      errs.some((path) => path.endsWith('turnover')),
      'missing turnover must fail, not become 0',
    );

    const nan = await errorsFor(
      completedReport({ totals: [{ ...base, quantity: '0', turnover: 'NaN' }] }),
    );
    assert.ok(nan.length > 0);
  });

  it('stores decimals exactly rather than as floating point', async () => {
    const report = new Report(
      completedReport({
        totals: [{ currency: 'USD', lineCount: 1, quantity: '1', turnover: '0.10' }],
      }),
    );
    assert.equal(report.totals[0].turnover.toString(), '0.10');
  });

  it('rejects negative or fractional counts', async () => {
    const totals = [{ currency: 'USD', lineCount: -1, quantity: '1', turnover: '1' }];
    assert.ok((await errorsFor(completedReport({ totals }))).some((p) => p.endsWith('lineCount')));
    const fractional = [{ currency: 'USD', lineCount: 1.5, quantity: '1', turnover: '1' }];
    assert.ok(
      (await errorsFor(completedReport({ totals: fractional }))).some((p) =>
        p.endsWith('lineCount'),
      ),
    );
    assert.ok((await errorsFor(completedReport({ rowCount: -1 }))).includes('rowCount'));
  });

  it('refuses to complete a report with missing or incomplete data', async () => {
    assert.ok(
      (await errorsFor(completedReport({ completedAt: undefined }))).includes('completedAt'),
    );
    assert.ok((await errorsFor(completedReport({ rowCount: undefined }))).includes('rowCount'));
    const partial = { source: 'GAAP_UNITY', fetchedAt: NOW, complete: false };
    assert.ok(
      (await errorsFor(completedReport({ provenance: partial }))).includes('provenance.complete'),
    );
    const unfetched = { source: 'GAAP_UNITY', complete: true };
    assert.ok(
      (await errorsFor(completedReport({ provenance: unfetched }))).includes(
        'provenance.fetchedAt',
      ),
    );
    const withError = { code: 'GAAP_TIMEOUT' };
    assert.ok((await errorsFor(completedReport({ error: withError }))).includes('error'));
  });

  it('refuses to complete a report whose rows were not verified (no integrity record)', async () => {
    assert.ok((await errorsFor(completedReport({ integrity: undefined }))).includes('integrity'));
    const badDigest = { rowsChecksum: 'not-a-digest', verifiedAt: NOW };
    assert.ok(
      (await errorsFor(completedReport({ integrity: badDigest }))).includes(
        'integrity.rowsChecksum',
      ),
    );
  });

  it('requires failure metadata on failed reports', async () => {
    assert.ok((await errorsFor(pendingReport({ status: 'failed' }))).includes('failedAt'));
    assert.ok(
      (await errorsFor(pendingReport({ status: 'failed', failedAt: NOW }))).includes('error.code'),
    );
    await new Report(
      pendingReport({
        status: 'failed',
        failedAt: NOW,
        error: { code: 'GAAP_TIMEOUT', message: 'Source timed out' },
      }),
    ).validate();
  });

  it('rejects completion timestamps on pending reports', async () => {
    assert.ok((await errorsFor(pendingReport({ completedAt: NOW }))).includes('completedAt'));
  });

  it('requires a freshness label when cached data was used', async () => {
    const provenance = { source: 'GAAP_UNITY', usedCache: true };
    const errs = await errorsFor(pendingReport({ provenance }));
    assert.ok(errs.includes('provenance.cacheFreshness'));
    await new Report(
      pendingReport({ provenance: { ...provenance, cacheFreshness: 'stale' } }),
    ).validate();
  });
});

const skip = await skipUnlessMongo();

describe('Report persistence (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });

  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  it('creates the createdAt and status indexes on the reports collection', async () => {
    const indexes = await Report.collection.indexes();
    const keys = indexes.map((index) => JSON.stringify(index.key));
    assert.ok(keys.includes(JSON.stringify({ createdAt: -1 })), keys.join());
    assert.ok(keys.includes(JSON.stringify({ status: 1 })), keys.join());
  });

  it('round-trips a completed report with exact decimals and timestamps', async () => {
    const saved = await Report.create(completedReport());
    const loaded = await Report.findById(saved._id).lean();
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(loaded.totals.length, 2);
    assert.equal(loaded.totals[0].turnover.toString(), '10.50');
    assert.ok(loaded.createdAt instanceof Date && loaded.updatedAt instanceof Date);
    assert.equal(loaded.provenance.fetchedAt.toISOString(), NOW.toISOString());
  });

  it('refuses to save changes to a completed report', async () => {
    const saved = await Report.create(completedReport());
    const loaded = await Report.findById(saved._id);
    loaded.filters.endDate = '20261130';
    await assert.rejects(loaded.save(), ReportImmutableError);

    const again = await Report.findById(saved._id);
    assert.equal(again.filters.endDate, '20261107');
  });

  it('refuses to re-save a document that was just completed in the same session', async () => {
    const saved = await Report.create(completedReport());
    saved.rowCount = 99;
    await assert.rejects(saved.save(), ReportImmutableError);
  });

  it('cannot rewrite a completed report through query updates', async () => {
    const saved = await Report.create(completedReport());
    const update = await Report.updateOne({ _id: saved._id }, { $set: { rowCount: 999 } });
    assert.equal(update.matchedCount, 0);
    const replaced = await Report.findOneAndUpdate(
      { _id: saved._id },
      { rowCount: 5 },
      { returnDocument: 'after' },
    );
    assert.equal(replaced, null);
    // A caller-supplied status filter cannot widen the guard either.
    const forced = await Report.updateOne(
      { _id: saved._id, status: 'completed' },
      { $set: { rowCount: 7 } },
    );
    assert.equal(forced.matchedCount, 0);
    assert.equal((await Report.findById(saved._id)).rowCount, 2);
  });

  it('lets a pending report become completed exactly once', async () => {
    const pending = await Report.create(pendingReport());
    const done = completedReport();
    pending.set({
      status: done.status,
      completedAt: done.completedAt,
      rowCount: done.rowCount,
      provenance: done.provenance,
      totals: done.totals,
      integrity: done.integrity,
    });
    await pending.save();
    assert.equal((await Report.findById(pending._id)).status, 'completed');

    const second = await Report.updateOne({ _id: pending._id }, { $set: { status: 'pending' } });
    assert.equal(second.matchedCount, 0);
    assert.equal((await Report.findById(pending._id)).status, 'completed');
  });

  it('allows updating pending and failed reports via queries', async () => {
    const pending = await Report.create(pendingReport());
    const result = await Report.updateOne({ _id: pending._id }, { $set: { startedAt: NOW } });
    assert.equal(result.matchedCount, 1);
    assert.equal(mongoose.connection.name, dbName);
  });
});
