# Current Self Diagnostic

## Current goal
Stage 8 — 지원조건 구조화.

## Objective boundary
Stage 8 is not the user's eligibility decision. It converts each recruitment posting into an objective, readable structure using board title/list metadata, detail-page text, and attachments.

## Data model
Posting → common requirements + one or more recruitment units.

Each recruitment unit carries:
- job/field name,
- headcount when derivable,
- work location and employment type,
- education / license / experience / age / major / job-related / legal-identity / other requirements,
- required / preferred / unknown,
- source-linked evidence.

## Multi-position postings
A posting containing different jobs, grades, locations, headcounts or requirements is split into separate recruitment units so conditions are not incorrectly merged.

## Analysis-state rule
`unknown/not-specified` is different from `analysis-failed`.
A missing condition does not mean a failed parser, and a failed attachment parse does not mean the posting has no condition.

## Output
- `data/stage8-eligibility-report.json`: official Stage-8 objective structure.
- `data/requirement-report.json`: compatibility alias during migration.
- `data/jobs.json`: existing personal-fit output remains unchanged for now.

## Goal-progress
This patch establishes the Stage-8 production data contract and integration point. Stage-8 completion still requires real-run validation that current postings are correctly split and structured.
