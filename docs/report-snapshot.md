# Immutable report snapshot (Feature 21)

A report that reaches `completed` is a historical result set: its filters, totals, provenance,
calculation version and detail rows never change. Regenerating creates a new report id.

## What is saved

| Where                                | What                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports` (one document)             | exact filters, per-currency `totals`, `rowCount`, `provenance` (source, `sourceStartedAt`, `fetchedAt`, cache fields, `complete`), `calculationVersion`, `schemaVersion`, timestamps, and `integrity` (`sha256` of all rows, `verifiedAt`) |
| `reportRows` (one document per line) | the normalized eligible lines, `lineIndex` 0..n-1, linked by `reportId`; indexed (`reportId`+`lineIndex` unique, `reportId`+`sourceLineKey` unique, plus product/node/currency)                                                            |

No row list is ever embedded in the report document, so it stays a few KB whatever the volume.

## Size bounds (`SNAPSHOT_SIZE_LIMITS`)

- One row: at most 16 KiB (real rows are a few hundred bytes). Larger is refused before anything is written.
- One insert batch: at most 1000 rows **and** 8 MiB.
- The report document: at most 1 MiB (checked before completion); MongoDB's limit is 16 MiB.
- Decimals: at most 34 significant digits (Decimal128 would otherwise round silently); JS numbers are refused, money is text.

## Completion (`markCompleted`)

1. **Validate in memory** (`prepareSnapshot`): every row well formed, `lineIndex` sequential, no repeated source line,
   currency valid (`UNKNOWN` allowed, never defaulted), and the rows reconcile with `totals` **per currency**
   (line count, quantity, turnover, exact decimal sums; currencies never merged). Nothing is written on failure.
2. **Write rows** in bounded batches while the report is still `pending`.
3. **Read back** every row from MongoDB and compare count, per-currency sums and checksum with what was meant to be written.
4. **Complete** with a conditional update that only matches while the report is still `pending`. The model also
   requires `integrity` before `completed` is valid.

Any failure deletes exactly the rows this call wrote (by their own `_id`s, so a concurrent call's rows are never touched);
the report stays `pending` and the generator records `failed` (`SNAPSHOT_SAVE_FAILED`). Readers only serve `completed`
reports, so rows of an unfinished report are never visible.

MongoDB multi-document transactions are not used (they need a replica set; the Railway/Atlas topology is not confirmed here).
The order above (rows, verify, then a single-document completion) gives the same visible guarantee for readers.

## Immutability

- A completed report cannot be re-completed, failed, re-saved, or changed through `updateOne`/`replaceOne`/`findOneAndUpdate` (model guards).
- Rows are write-once: `save` on an existing row and every query update/replace/delete throws `ReportRowImmutableError`,
  except the snapshot repository's own rollback of rows it wrote for a report that never completed.
- `Model.collection`, `bulkWrite` and direct database access bypass these guards. They are not used by the application.
  `verifySnapshot` detects such edits (changed amount, removed row, wrong order).
- Regeneration: `POST /api/v1/reports` always creates a new pending report with a new id; an existing report is never reopened.

## Reading (repository API; no HTTP route is added by this feature)

- `getSnapshot(reportId)` metadata, filters, totals, provenance, integrity of a completed report; `null` otherwise.
- `readRows(reportId, { afterLineIndex, limit })` keyset-paged rows in `lineIndex` order (limit 1..1000); `null` unless completed.
- `verifySnapshot(reportId)` re-checks count, per-currency totals and checksum from the stored rows: `{ ok, problems, rowCount }`.

Amounts come back as decimal text exactly as saved (Decimal128 exponent form is expanded, digits unchanged); timestamps as ISO 8601 UTC.

## Open items

- Retention/cleanup of saved reports is not decided or implemented.
- A process crash between the row write and completion leaves a `pending` report with orphan rows (never served); no sweeper exists.
- A `schemaVersion` migration path does not exist yet (only version 1).
