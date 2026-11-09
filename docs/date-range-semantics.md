# Report date range semantics (Feature 12)

Status: timezone and future-date policy **decided by the owner (2026-11-08)**; GAAP `createdDate`
boundary mapping and the maximum range are still **OPEN**. Nothing below is verified against GAAP.

## Decided (implemented in `frontend/src/features/reports/date-range.js`)

- A range is two **calendar dates** written `YYYYMMDD`. They carry no time and no timezone.
- **Format (owner decision, 2026-11-08): `YYYYMMDD`, the same as `sample.js`'s GAAP filter**
  (`["createdDate","gte","20261105"]`). Form state, validation and API serialization all use it.
  Only the browser's `<input type="date">`, which can only speak `YYYY-MM-DD`, is converted at the
  edge (`toInputValue` / `fromInputValue`). Dashed dates are rejected as input to the range rules.
  `sample.js` uses the same day for gte and lte to fetch one day, which suggests an inclusive `lte`
  on a date-only value; that is an observation of the script, not verified.
- **Stored format:** the `Report` model (Feature 05) validates `filters.startDate` / `endDate` as
  `YYYYMMDD` (`isCompactDate` in `backend/src/models/shared.js`), so the frontend value is stored
  unchanged. Dashed dates are rejected. No reports had been saved, so no data needed migrating.
- **Reporting timezone: Central Africa Time, Africa/Harare (UTC+2, no daylight saving).** "Today"
  is computed in that timezone (`todayInReportingTimezone`), not in the browser's timezone or UTC.
  Example: 22:30 UTC on 31 Oct is already 1 Nov in Harare.
- **Future dates are rejected** (start or end after today in Harare). Today itself is allowed.
- The range is **inclusive of both days**: 20261001 to 20261031 is 31 days; a single day is valid.
- Dates are never passed through `Date` in local time. UTC midnight is used only to check calendar
  validity and count days, so the browser's timezone and daylight-saving changes cannot shift a date.
- Validation: both dates required, real calendar dates (20260230 and 20261301 rejected), not in
  the future, start <= end, inclusive span <= maximum range.
- API serialization (`serializeDateRange`): exactly `{ "startDate": "YYYYMMDD", "endDate": "YYYYMMDD" }`,
  fixed key order, trimmed; it throws on an invalid range.
- Maximum range is a **provisional 92 days** (no approved value). Override in the browser with
  `VITE_REPORT_MAX_RANGE_DAYS`. The cap and the future-date rule are UI checks only; the backend
  must enforce both (using Africa/Harare for "today") when report generation is built.

## OPEN decisions (blockers, owner/GAAP input needed)

1. **GAAP `createdDate` boundary.** How `startDate`/`endDate` map to a `createdDate` filter:
   start of the start day in Harare time, and whether the end bound is the end of the end day or
   the start of the next day (exclusive). Whether GAAP treats its own `createdDate` bounds as
   inclusive or exclusive is unverified. Feature 14 must not guess; until confirmed, no date is
   converted to an instant.
2. **Approved maximum range** (92 days is provisional).
3. ~~Whether GAAP timestamps are Harare time or UTC~~ **Answered by the owner (2026-11-08):** GAAP
   stores `createdDate` and `updatedDate` as ISO 8601 UTC instants, e.g. `"2023-04-17T05:55:47.374Z"`.
   Consequence: a Harare report day (UTC+2) is not a UTC day. 20261105 in Harare runs from
   2026-11-04T22:00:00.000Z to 2026-11-05T21:59:59.999Z, so a transaction at 23:30 UTC on 4 Nov
   belongs to the Harare day 5 Nov. What is still unverified is how the date-only filter value
   (`"20261105"` in `sample.js`) is interpreted against these UTC instants (as a UTC day, or
   otherwise). If GAAP reads it as a UTC day, up to two hours either side of a Harare day would be
   mis-assigned, and Feature 14 would need to filter on explicit instants or re-bucket rows by
   Harare day after fetching. Not decided; verify with a live read-only probe before relying on it.
