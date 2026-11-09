import mongoose, { Schema } from 'mongoose';
import { currencyField, decimalField } from './shared.js';

/**
 * One normalized sales line belonging to a saved report. Rows live in their own
 * collection (linked by reportId) so large reports never approach MongoDB's
 * 16 MiB document limit.
 *
 * Field names are the INTERNAL contract. How GAAP fields map onto them, and
 * what turnover/currency mean, is unverified until the GAAP client work.
 */
const reportRowSchema = new Schema(
  {
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
    /** Position within the report; gives stable, pageable ordering. */
    lineIndex: { type: Number, required: true, min: 0, validate: Number.isInteger },
    /** Stable de-duplication key for the source line (never counted twice per report). */
    sourceLineKey: { type: String, required: true, trim: true, maxlength: 200 },
    transactionAt: { type: Date, required: true },
    nodeId: { type: String, required: true, trim: true },
    nodeName: { type: String, trim: true },
    productId: { type: String, required: true, trim: true },
    productName: { type: String, trim: true },
    departmentId: { type: String, trim: true },
    brandId: { type: String, trim: true },
    currency: currencyField,
    // Signed: refunds and reversals may be negative. Missing is invalid, not 0.
    quantity: decimalField('quantity'),
    turnover: decimalField('turnover'),
    warnings: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'reportRows' },
);

// Pageable, ordered reads of one report; reportId is the leading key.
reportRowSchema.index({ reportId: 1, lineIndex: 1 }, { unique: true });
// Rejects duplicate source lines within a report.
reportRowSchema.index({ reportId: 1, sourceLineKey: 1 }, { unique: true });
// Filtered/grouped reads within one report.
reportRowSchema.index({ reportId: 1, productId: 1 });
reportRowSchema.index({ reportId: 1, nodeId: 1 });
reportRowSchema.index({ reportId: 1, currency: 1 });

/** Thrown when code tries to change or delete a stored row. Rows are written once. */
export class ReportRowImmutableError extends Error {
  constructor() {
    super('Report rows are write-once and cannot be modified or deleted');
    this.name = 'ReportRowImmutableError';
    this.code = 'REPORT_ROW_IMMUTABLE';
  }
}

/**
 * Query option that permits deleting rows. Only the snapshot repository's rollback (removing rows it
 * wrote itself for a report that never completed) sets it.
 */
export const ROW_ROLLBACK_OPTION = 'allowRowRollback';

// Rows are a historical result set (Feature 21): no document re-save, no query update/replace/delete,
// except the explicit rollback above. Direct driver access (Model.collection, bulkWrite) bypasses this
// and must not be used.
reportRowSchema.pre('save', function blockRowResave() {
  if (!this.isNew) throw new ReportRowImmutableError();
});
reportRowSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ],
  function blockRowQueryChanges() {
    if (this.getOptions()[ROW_ROLLBACK_OPTION] !== true) throw new ReportRowImmutableError();
  },
);

export const ReportRow = mongoose.models.ReportRow ?? mongoose.model('ReportRow', reportRowSchema);
