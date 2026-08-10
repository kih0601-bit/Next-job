# Current Self Diagnostic

## Uploaded run
Generated: 2026-08-10T01:27:49.624Z

## Stage 7
Stage-7 gate remains `close-stage-7` with 20/20 implementation proof.

### Ulsan Facilities Corporation 403 observation
The console showed repeated production-collector POST pagination HTTP 403 errors, but the authoritative pipeline probe completed all 19 pages with 189 raw = 189 unique and no errors. The probe evidence shows the site requires a fresh CSRF form token and captured session cookie. Therefore the 403 is a duplicate production-collector session-replay defect, not a Stage-7 data-proof failure.

v110 makes the collector use the same fresh form session/cookie principle and bounded retry.

## Stage 8
The generated Stage-8 report still contains 0 postings / 0 recruitment units even though the repository contains the v109 objective-input code.

The uploaded cache contains 2,376 entries and none carries `stage8Posting`, while run metrics still report many cache hits. This is an unacceptable silent mismatch between intended cache migration and observed output.

v110 hardens this boundary:
- cached outcomes are reusable for Stage 8 only when an explicit Stage-8 cache schema version and a structured posting are present;
- source output records Stage-8 candidate and derived counts;
- if objective candidates exist but zero structured postings are produced, collection fails loudly with `STAGE8_SILENT_FAILURE` instead of publishing an empty success report.

## Goal-progress decision
Stage 7 remains closed. Stage 8 remains open.
The next run should either produce real structured postings or fail with an exact Stage-8 input/derivation blocker; another silent 0-posting success is no longer acceptable.
