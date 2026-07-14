# Issue list pagination & truncation signaling (TON-3263)

`GET /api/companies/{companyId}/issues` is paginated. It never truncates
silently: every response carries metadata that says whether the page is a cut
of a larger result set.

## Server limits

| Constant | Value | Meaning |
| --- | --- | --- |
| `ISSUE_LIST_DEFAULT_LIMIT` | 500 | Page size when `?limit` is omitted |
| `ISSUE_LIST_MAX_LIMIT` | 1000 | Hard server max per page |

A requested `limit` above the max is **clamped to the max, with an explicit
signal** (`X-List-Limit-Clamped: true` header, and `limitClamped: true` in the
`includeMeta` envelope). It is never silently honored-looking. A non-numeric or
non-positive `limit` is rejected with 400.

## Response headers (always present)

| Header | Meaning |
| --- | --- |
| `X-Total-Count` | Exact number of issues matching the filters (after filtering, before paging). Omitted for actors without company-scope read, who would otherwise learn counts of issues they cannot see. |
| `X-Has-More` | `true` when rows exist beyond this page |
| `X-Next-Offset` | Offset to request the next page (only when `X-Has-More: true`) |
| `X-List-Limit` | The limit actually applied |
| `X-List-Offset` | The offset actually applied |
| `X-List-Max-Limit` | The server max (`ISSUE_LIST_MAX_LIMIT`) |
| `X-List-Limit-Clamped` | `true` when the requested limit exceeded the max (only set when clamped) |

## Body envelope (opt-in)

`?includeMeta=true` switches the body from a bare array (the backward-
compatible default) to:

```json
{
  "items": [ ... ],
  "total": 3195,
  "hasMore": true,
  "nextOffset": 1000,
  "limit": 1000,
  "offset": 0,
  "maxLimit": 1000,
  "requestedLimit": 5000,
  "limitClamped": true
}
```

`total` is `null` for actors without company-scope read (see header note).

## Correct exhaustive-listing pattern

Loop on `hasMore`/`nextOffset` (or `X-Has-More`/`X-Next-Offset`), not on
"returned rows < limit", and cross-check `total` at the end:

```text
offset = 0
while true:
  page = GET .../issues?limit=1000&offset={offset}&includeMeta=true
  collect page.items
  if not page.hasMore: break
  offset = page.nextOffset
assert collected == page.total   # company-scope actors
```

## Implementation notes

- `hasMore` is derived by over-fetching one row past the page in
  `routes/issues.ts`, so it is exact for every filter combination.
- `total` comes from `issueService.countList`, which shares its WHERE-clause
  builder (`buildIssueListConditions` in `services/issues.ts`) with the page
  query — the count cannot drift from what `list` matches. The
  `attention=blocked` path uses `countBlockedInboxIssues`, which mirrors the
  blocked list's post-enrichment filters.
- Regression coverage: `server/src/__tests__/issue-list-pagination-meta-routes.test.ts`
  seeds 1,050 issues (> `ISSUE_LIST_MAX_LIMIT`) and asserts count/`hasMore`/
  `total` coherence, clamp signaling, and backward-compatible default body.
