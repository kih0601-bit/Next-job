# v103 Deep Recheck

The v102 patch was re-traced end-to-end rather than only at the adapter/Pagination layer.

Confirmed missed path:
`extractKepcoRecords` -> `inspectListingPage` -> `collect.mjs candidateMap` -> cache -> final job link.

`collect.mjs` canonicalizes candidate links several times. Before v103, `canonicalJobUrl()` did not recognize KEPCO's `employYear/employId/employSeq` as durable identity, so those values could be stripped again downstream even though v102 preserved them upstream.

v103 moves the correction to the shared canonicalization rule by registering the three fields as durable detail parameters. This closes candidate dedup, cache, bootstrap matching, and final-link identity at once.

No additional institution-specific cache changes were made without second-run evidence.
