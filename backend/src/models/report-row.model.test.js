import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { ensureModelIndexes } from './index.js';
import { ReportRow, ReportRowImmutableError } from './report-row.model.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  skipUnlessMongo,
} from './support/mongo-fixture.js';

function row(overrides = {}) {
  return {
    reportId: new mongoose.Types.ObjectId(),
    lineIndex: 0,
    sourceLineKey: 'DEMO-TXN-1:1',
    transactionAt: new Date('2026-11-05T12:00:00Z'),
    nodeId: 'DEMO-NODE-1',
    productId: 'DEMO-PRODUCT-1',
    currency: 'USD',
    quantity: '2',
    turnover: '10.50',
    ...overrides,
  };
}

async function errorsFor(data) {
  const error = await new ReportRow(data).validate().then(
    () => null,
    (e) => e,
  );
  return error ? Object.keys(error.errors) : [];
}

describe('ReportRow validation', () => {
  it('accepts a normalized line and defaults warnings to empty', async () => {
    const doc = new ReportRow(row());
    await doc.validate();
    assert.deepEqual([...doc.warnings], []);
  });

  it('requires every identifying field', async () => {
    for (const field of [
      'reportId',
      'lineIndex',
      'sourceLineKey',
      'transactionAt',
      'nodeId',
      'productId',
    ]) {
      const data = row();
      delete data[field];
      assert.ok((await errorsFor(data)).includes(field), `${field} should be required`);
    }
  });

  it('never defaults a missing currency; UNKNOWN is explicit', async () => {
    const data = row();
    delete data.currency;
    assert.ok((await errorsFor(data)).includes('currency'));
    assert.deepEqual(await errorsFor(row({ currency: 'UNKNOWN' })), []);
    assert.ok((await errorsFor(row({ currency: 'usd' }))).includes('currency'));
    assert.ok((await errorsFor(row({ currency: '' }))).includes('currency'));
  });

  it('distinguishes zero and negative amounts from missing ones', async () => {
    assert.deepEqual(await errorsFor(row({ quantity: '0', turnover: '0' })), []);
    assert.deepEqual(await errorsFor(row({ quantity: '-1', turnover: '-5.25' })), []);

    const noTurnover = row();
    delete noTurnover.turnover;
    assert.ok((await errorsFor(noTurnover)).includes('turnover'));
    const noQuantity = row();
    delete noQuantity.quantity;
    assert.ok((await errorsFor(noQuantity)).includes('quantity'));
    assert.ok((await errorsFor(row({ turnover: 'Infinity' }))).length > 0);
  });

  it('rejects bad line indexes and oversized source keys', async () => {
    assert.ok((await errorsFor(row({ lineIndex: -1 }))).includes('lineIndex'));
    assert.ok((await errorsFor(row({ lineIndex: 1.5 }))).includes('lineIndex'));
    assert.ok((await errorsFor(row({ sourceLineKey: 'x'.repeat(201) }))).includes('sourceLineKey'));
  });
});

const skip = await skipUnlessMongo();

describe('ReportRow persistence (isolated MongoDB database)', { skip }, () => {
  const { dbName, config } = createIsolatedDatabase();

  before(async () => {
    await connectDatabase(config);
    await ensureModelIndexes();
  });

  after(async () => {
    await dropIsolatedDatabase(dbName);
    await disconnectDatabase();
  });

  it('creates the reportId-led indexes', async () => {
    const indexes = await ReportRow.collection.indexes();
    const byKey = new Map(indexes.map((index) => [JSON.stringify(index.key), index]));
    assert.equal(byKey.get(JSON.stringify({ reportId: 1, lineIndex: 1 }))?.unique, true);
    assert.equal(byKey.get(JSON.stringify({ reportId: 1, sourceLineKey: 1 }))?.unique, true);
    for (const field of ['productId', 'nodeId', 'currency']) {
      assert.ok(
        byKey.has(JSON.stringify({ reportId: 1, [field]: 1 })),
        `missing index on ${field}`,
      );
    }
  });

  it('round-trips exact decimals and keeps currencies as stored', async () => {
    const reportId = new mongoose.Types.ObjectId();
    await ReportRow.create([
      row({ reportId, lineIndex: 0, sourceLineKey: 'a', currency: 'USD', turnover: '0.10' }),
      row({ reportId, lineIndex: 1, sourceLineKey: 'b', currency: 'UNKNOWN', turnover: '-3' }),
    ]);
    const rows = await ReportRow.find({ reportId }).sort({ lineIndex: 1 }).lean();
    assert.deepEqual(
      rows.map((r) => r.currency),
      ['USD', 'UNKNOWN'],
    );
    assert.equal(rows[0].turnover.toString(), '0.10');
    assert.equal(rows[1].turnover.toString(), '-3');
  });

  it('rejects a duplicate source line or line index within one report', async () => {
    const reportId = new mongoose.Types.ObjectId();
    await ReportRow.create(row({ reportId, lineIndex: 0, sourceLineKey: 'dup' }));
    await assert.rejects(
      ReportRow.create(row({ reportId, lineIndex: 1, sourceLineKey: 'dup' })),
      (error) => error.code === 11000,
    );
    await assert.rejects(
      ReportRow.create(row({ reportId, lineIndex: 0, sourceLineKey: 'other' })),
      (error) => error.code === 11000,
    );
  });

  it('rows are write-once: no re-save, query update, replace or delete', async () => {
    const saved = await ReportRow.create(row({ sourceLineKey: 'once' }));
    const loaded = await ReportRow.findById(saved._id);
    loaded.turnover = '999';
    await assert.rejects(loaded.save(), ReportRowImmutableError);
    await assert.rejects(
      ReportRow.updateOne({ _id: saved._id }, { $set: { turnover: '999' } }),
      ReportRowImmutableError,
    );
    await assert.rejects(
      ReportRow.updateMany({ reportId: saved.reportId }, { $set: { currency: 'ZWG' } }),
      ReportRowImmutableError,
    );
    await assert.rejects(
      ReportRow.deleteMany({ reportId: saved.reportId }),
      ReportRowImmutableError,
    );
    await assert.rejects(ReportRow.deleteOne({ _id: saved._id }), ReportRowImmutableError);
    await assert.rejects(
      ReportRow.findOneAndUpdate({ _id: saved._id }, { $set: { turnover: '1' } }),
      ReportRowImmutableError,
    );
    const stored = await ReportRow.findById(saved._id).lean();
    assert.equal(stored.turnover.toString(), '10.50');
    assert.equal(stored.currency, 'USD');
  });

  it('allows the same source line in different reports', async () => {
    await ReportRow.create(row({ sourceLineKey: 'shared' }));
    await assert.doesNotReject(ReportRow.create(row({ sourceLineKey: 'shared' })));
  });
});
