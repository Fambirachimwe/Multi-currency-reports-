import { formatDateTime } from '@/lib/format';

const FRESHNESS_LABEL = {
  fresh: 'Fresh',
  stale: 'Stale (older than the cache window)',
  incomplete: 'Incomplete',
};

/** One-line provenance for the node list: where it came from, when, and how fresh. */
function nodesProvenanceText(meta) {
  if (!meta?.fetchedAt) return null;
  const origin = meta.origin === 'database' ? 'Saved copy' : 'Fetched from GAAP just now';
  const saved = meta.persisted === false ? ' · not saved to the database' : '';
  const freshness = FRESHNESS_LABEL[meta.cacheFreshness];
  return `${origin} · last fetched from GAAP ${formatDateTime(meta.fetchedAt)}${freshness ? ` · ${freshness}` : ''}${saved}`;
}

export function NodesProvenance({ meta, className }) {
  const text = nodesProvenanceText(meta);
  return text ? <p className={className ?? 'text-xs text-text-muted'}>{text}</p> : null;
}
