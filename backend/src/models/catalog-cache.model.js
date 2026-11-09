import mongoose, { Schema } from 'mongoose';

// 'CONFIGURED_MAPPING' covers catalog data from an explicit mapping where GAAP
// has no confirmed endpoint. Add sources only when they are verified.
export const CATALOG_SOURCES = Object.freeze(['GAAP_UNITY', 'CONFIGURED_MAPPING']);
// 'incomplete' marks a partial fetch; it must never be shown as current data.
export const CATALOG_FRESHNESS_VALUES = Object.freeze(['fresh', 'stale', 'incomplete']);

const catalogCacheSchema = new Schema(
  {
    source: { type: String, required: true, enum: CATALOG_SOURCES },
    /** Cache key within a source, e.g. "nodes" or "products". */
    key: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    /** Cached reference data. Must not contain secrets. */
    payload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    freshness: { type: String, required: true, enum: CATALOG_FRESHNESS_VALUES, default: 'fresh' },
  },
  { timestamps: true, collection: 'catalogCache' },
);

// One entry per source and key.
catalogCacheSchema.index({ source: 1, key: 1 }, { unique: true });
// Expiry lookups and cleanup. Deliberately not a TTL index: retention is
// undecided, and silently deleting entries would hide stale/incomplete state.
catalogCacheSchema.index({ expiresAt: 1 });

catalogCacheSchema.pre('validate', function enforceCacheRules() {
  if (this.fetchedAt && this.expiresAt && this.expiresAt <= this.fetchedAt) {
    this.invalidate('expiresAt', 'expiresAt must be after fetchedAt');
  }
});

/**
 * True only when the entry is marked fresh AND has not expired. Stale,
 * incomplete and expired entries are never "current".
 * @param {Date} [now]
 */
catalogCacheSchema.methods.isCurrent = function isCurrent(now = new Date()) {
  return this.freshness === 'fresh' && this.expiresAt > now;
};

export const CatalogCache =
  mongoose.models.CatalogCache ?? mongoose.model('CatalogCache', catalogCacheSchema);
