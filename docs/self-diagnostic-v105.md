# v105 Deep Diagnostic

## Uploaded run
- 20 sources.
- Collect: ~246 seconds.
- KEPCO: durable identity fix confirmed (132 raw / 132 unique / 0 duplicate). Failure is now a single page-3 timeout, not identity collapse.
- UTP 304/304 hits, WFPS 217/217, UIPA 59/59, UUC 76/76, KOSHA 76/76: prior identity/cache work is stable in this run.
- Ulju Culture Foundation: one exact ROWAREA_RECORD exists. HTML form has no pagination field and no explicit pager markup.

## Actions leverage improvements
Pagination transient failures retry in the same run and retain retry evidence. This avoids spending another full Actions cycle on a one-off timeout where possible.

## Corrected proof logic
HUBST single-page proof no longer trusts the broad generic `pageControls` hint. It requires exact ROWAREA_RECORD evidence plus absence of real page parameters and explicit pager markup.

## Provenance
The report VERSION label is advanced to v105; the previous stale v100 label could make later artifact-to-code comparisons ambiguous.
