# v104 Actions-as-Diagnostic Audit

## Finding
The workflow already uploads extensive artifacts, but two gaps forced avoidable repeat Actions:
1. Pagination could be verified even when extracted record identity catastrophically collapsed across pages.
2. Cache metrics counted `identity-mismatch` without preserving the compared identity materials, requiring another code/log round-trip to infer the changing component.

## Correction
- Add a conservative generic identity-collapse guard to Pagination verification.
- Add bounded cache-miss evidence samples to collect metrics so one run captures current vs cached identities/fingerprints and cache age.

## Expected effect
The next Actions run should simultaneously answer:
- whether full-page traversal is structurally complete,
- whether cross-page identities remain plausible,
- which exact identity/fingerprint component caused cache misses,
- which institutions dominate runtime.

This improves the diagnostic value of one Actions run without weakening collection correctness.
