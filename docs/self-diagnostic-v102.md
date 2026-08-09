# v102 Self Diagnostic

## Evidence reviewed
- `data/pipeline-report.json`: 20 sources; Stage 7 implementation 19/20 and current-run 17/20 in the uploaded Actions result.
- `data/run-metrics.json`: Collect about 20m 06s. UTP 304 cache hits / 304 migrations; WFPS 217 cache hits / 217 migrations.
- KEPCO Pagination: 16 pages, 141 raw rows, but 1 unique and 140 duplicates. Raw captured `addList.do` HTML contains distinct `employYear/employId/employSeq` values for notices.

## Confirmed root cause and correction
The KEPCO adapter correctly decoded the durable identifiers but stripped them by canonicalizing the detail URL. Pagination reconciliation/fingerprint canonicalized them again. v102 preserves query-bearing KEPCO detail links and uses query-bearing extracted links as pagination identity.

## Workflow
During development the 3-hour schedule is disabled; manual `workflow_dispatch` remains.

## Not modified without evidence
Other institutions showing identity-mismatch cache misses were not generalized from one run. Their next-run stability should be compared before changing identity rules.
