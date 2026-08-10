# v136 — Legacy retirement + Code-first benchmark gate

- Retired old scheduled 1-10 institution-site collector without deleting legacy code.
- Added explicit JOB-ALIO/Cleaneye field maps to prevent fuzzy-field collapse seen in v135.
- Added conservative Code-only extraction with Evidence + Rule ID and unresolved fail-safe.
- Added 100-case real API benchmark workflow with **zero OpenAI calls**.
- Benchmark auto result is candidate_complete/unresolved only; Correct/Wrong requires source comparison.
- Narailter deliberately excluded from v136 benchmark until its current-data request and schema are verified.
