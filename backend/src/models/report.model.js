import mongoose, { Schema } from 'mongoose';
import { currencyField, decimalField, isCompactDate } from './shared.js';

/** Version of the persisted report document shape. Bump on incompatible changes. */
export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_STATUSES = Object.freeze(['pending', 'completed', 'failed']);
export const REPORT_SOURCES = Object.freeze(['GAAP_UNITY']);
export const CACHE_FRESHNESS_VALUES = Object.freeze(['fresh', 'stale', 'not_applicable']);

/** Thrown when code tries to modify a report that is already completed. */
export class ReportImmutableError extends Error {
  constructor() {
    super('A completed report cannot be modified; regenerate to create a new report');
    this.name = 'ReportImmutableError';
    this.code = 'REPORT_IMMUTABLE';
  }
}

/**
 * Filters exactly as selected. Dates are calendar dates (YYYYMMDD, as in GAAP's createdDate filter) stored as
 * given: the reporting day is Africa/Harare (owner decision); range-end inclusivity at GAAP is UNVERIFIED
 * and must not be inferred here. Empty arrays mean "none
 * selected"; the report service decides what that implies.
 */
const filtersSchema = new Schema(
  {
    startDate: {
      type: String,
      required: true,
      validate: { validator: isCompactDate, message: 'startDate must be a real YYYYMMDD date' },
    },
    endDate: {
      type: String,
      required: true,
      validate: { validator: isCompactDate, message: 'endDate must be a real YYYYMMDD date' },
    },
    departmentIds: { type: [String], default: [] },
    productIds: { type: [String], default: [] },
    brandIds: { type: [String], default: [] },
    nodeIds: { type: [String], default: [] },
    currencies: { type: [String], default: [] },
  },
  { _id: false },
);

/** One entry per currency. Currencies are never summed into one another. */
const currencyTotalSchema = new Schema(
  {
    currency: currencyField,
    lineCount: { type: Number, required: true, min: 0, validate: Number.isInteger },
    quantity: decimalField('quantity'),
    turnover: decimalField('turnover'),
  },
  { _id: false },
);

const provenanceSchema = new Schema(
  {
    source: { type: String, required: true, enum: REPORT_SOURCES },
    /** When source extraction began; `fetchedAt` is when it finished. */
    sourceStartedAt: { type: Date },
    fetchedAt: { type: Date },
    usedCache: { type: Boolean, required: true, default: false },
    cacheFreshness: { type: String, enum: CACHE_FRESHNESS_VALUES, default: 'not_applicable' },
    /** True only when every required source page was fetched and processed. */
    complete: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

/**
 * Fingerprint of the detail rows, recorded at completion after the rows were read back from MongoDB
 * and reconciled with `totals` (Feature 21). Lets any later reader prove the snapshot is unchanged.
 */
const integritySchema = new Schema(
  {
    checksumAlgorithm: { type: String, required: true, enum: ['sha256'], default: 'sha256' },
    rowsChecksum: {
      type: String,
      required: true,
      match: [/^[a-f0-9]{64}$/, 'rowsChecksum must be a sha256 hex digest'],
    },
    verifiedAt: { type: Date, required: true },
  },
  { _id: false },
);

const errorSchema = new Schema(
  {
    code: { type: String, required: true, maxlength: 100 },
    // Must be a sanitized, user-safe message: no credentials, URLs or raw payloads.
    message: { type: String, maxlength: 500 },
    occurredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const reportSchema = new Schema(
  {
    status: { type: String, required: true, enum: REPORT_STATUSES, default: 'pending' },
    filters: { type: filtersSchema, required: true },
    totals: {
      type: [currencyTotalSchema],
      default: [],
      validate: {
        validator: (totals) => new Set(totals.map((t) => t.currency)).size === totals.length,
        message: 'totals must contain at most one entry per currency',
      },
    },
    rowCount: { type: Number, min: 0, validate: Number.isInteger },
    provenance: { type: provenanceSchema, required: true },
    schemaVersion: { type: Number, required: true, default: REPORT_SCHEMA_VERSION, min: 1 },
    calculationVersion: { type: String, trim: true, maxlength: 50 },
    integrity: { type: integritySchema },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    error: { type: errorSchema },
  },
  { timestamps: true, collection: 'reports' },
);

reportSchema.index({ createdAt: -1 });
reportSchema.index({ status: 1 });
// Saved Reports list (Feature 22): status filter + newest first, and sorting by report start date.
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ 'filters.startDate': -1, createdAt: -1 });

reportSchema.pre('validate', function enforceReportRules() {
  const { filters, status, provenance } = this;

  if (filters?.startDate && filters?.endDate && filters.startDate > filters.endDate) {
    this.invalidate('filters.endDate', 'endDate must not be before startDate');
  }

  if (provenance?.usedCache === true && !['fresh', 'stale'].includes(provenance.cacheFreshness)) {
    this.invalidate('provenance.cacheFreshness', 'cacheFreshness is required when cache was used');
  }

  // A report may only be completed once its data is whole and consistent.
  if (status === 'completed') {
    if (!this.completedAt) this.invalidate('completedAt', 'completedAt is required when completed');
    if (!provenance?.fetchedAt) {
      this.invalidate('provenance.fetchedAt', 'fetchedAt is required when completed');
    }
    if (provenance?.complete !== true) {
      this.invalidate('provenance.complete', 'a completed report must have complete source data');
    }
    if (this.rowCount === undefined || this.rowCount === null) {
      this.invalidate('rowCount', 'rowCount is required when completed');
    }
    if (!this.integrity?.rowsChecksum) {
      this.invalidate('integrity', 'integrity is required when completed (rows were not verified)');
    }
    if (this.error) this.invalidate('error', 'a completed report cannot carry an error');
    if (this.failedAt) this.invalidate('failedAt', 'a completed report cannot have failedAt');
  }

  if (status === 'failed') {
    if (!this.failedAt) this.invalidate('failedAt', 'failedAt is required when failed');
    if (!this.error?.code) this.invalidate('error.code', 'error.code is required when failed');
    if (this.completedAt) this.invalidate('completedAt', 'a failed report cannot be completed');
  }

  if (status === 'pending') {
    if (this.completedAt) this.invalidate('completedAt', 'a pending report cannot be completed');
    if (this.failedAt) this.invalidate('failedAt', 'a pending report cannot have failed');
  }
});

// Immutability: a completed report is a historical result set. Document saves
// are refused when the stored status was already completed...
reportSchema.post('init', function rememberStoredStatus() {
  this.$locals.storedStatus = this.status;
});
reportSchema.post('save', function rememberSavedStatus() {
  this.$locals.storedStatus = this.status;
});
reportSchema.pre('save', function blockCompletedOverwrite() {
  if (!this.isNew && this.$locals.storedStatus === 'completed' && this.isModified()) {
    throw new ReportImmutableError();
  }
});

// ...and query-based updates can never match a completed report, so they
// cannot rewrite one. A pending/failed -> completed transition still works,
// because the stored document is not yet completed when it is matched.
// Direct driver access (Model.collection) bypasses this and must not be used.
const GUARDED_QUERY_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
];
reportSchema.pre(GUARDED_QUERY_OPERATIONS, function excludeCompletedReports() {
  this.and([{ status: { $ne: 'completed' } }]);
});

export const Report = mongoose.models.Report ?? mongoose.model('Report', reportSchema);
