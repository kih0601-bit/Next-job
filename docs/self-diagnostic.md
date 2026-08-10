# Current Self Diagnostic

## Uploaded run
Generated: 2026-08-10T01:10:50.862Z

## Stage 7
`stage7Gate.decision = close-stage-7`.
20/20 Pagination implementation proof, no Stage-7 blocker.
Five sources are current-run historical/watch items; this does not reopen Stage 7.

## Stage 8 observed result
`stage8-eligibility-report.json` was generated but contained 0 postings / 0 recruitment units.

## Root cause
The first Stage-8 integration was placed after the existing personal list-selection boundary.
That boundary intentionally excludes contract/intern/license-job titles for the user's personal jobs output, so it is not a valid input boundary for objective Stage 8.

A second issue compounded it: the uploaded collection cache contains 2,376 legacy entries and none has `stage8Posting`. Reusing those entries would skip the new Stage-8 derivation even when a posting is otherwise eligible for objective analysis.

## v109 correction
- Stage 8 receives its own broader objective recruitment-posting candidate set.
- Personal list selection remains intact for `jobs.json`.
- Legacy cache entries without `stage8Posting` are reprocessed once instead of being accepted as Stage-8-complete cache hits.
- Personal jobs output is still gated by the original personal selection.

## Goal-progress
Stage 8 remains open. The next Actions run is now meaningful because it should produce real posting/recruitment-unit structures rather than an empty report.
