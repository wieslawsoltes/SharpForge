# A05 evidence relocation records

`initial-20261004.json` maps every tracked file under `docs/a05-evidence/` at
`cdfcb53fccc3aecd8bb128fc3ebf50eb853964c5` to the same relative suffix beneath
`planning/qualification/a05-evidence/`. That source is the isolated `bf48fd5c9`
packaging base plus Control's complete native archive (`4597fdf8a`). Every source
Git blob and raw byte is preserved; the manifest itself is additive.

The existing Studio build copies `docs` recursively. It has no qualification asset
contribution and no runtime dependency on this archive. Package/release size and
source-manifest policies are unchanged. This move makes qualification records
consistent with the existing qualification directory boundary; it is not a filter
applied to a size measurement. A complete build and output comparison remain
required before a size conclusion.

Archived JSON, logs, scripts and Markdown are immutable, including embedded old
paths. Most archived relative links still work within the moved tree. An original
outward link may describe its historical checkout layout; resolve it using the
source revision and this path map. The historical acceptance JSON is not rewritten.
Human-facing documentation links use the repository host because qualification
records are absent from the shipped site's `docs` directory.

New evidence should be committed directly beneath the new qualification prefix.
If an independently completed archive arrives at the old path, preserve its source
revision and original blobs, move only those new files, and add a separate manifest
here using the same format. Never replace the initial map or rewrite older reports.
The packaging regression checks the shipped index and all initial byte identities;
it does not prohibit subsequent evidence at the qualification location.

## Archived executable-suffix follow-up

`archived-drivers-20261004.json` appends `.txt` to three retained `.mjs` command
drivers from the historical profiling checkouts. Their imports name the original
temporary `a05-numeric-qualification` checkout; they are exact commands-as-run,
not modules runnable from this repository location. Every raw byte and Git blob
is unchanged. The original 3,307-file map and historical archive manifests remain
immutable, including their earlier filenames.

The normal module gate intentionally scans `planning` for `.js` and `.mjs` files.
It is unchanged: archived command text now has a text suffix, consistent with
the existing `before-scheduler-task-delivery.js.txt` archive. No module exclusion,
dynamic-code allowance, import rewrite or alternate gate is introduced.

`chain.json` identifies the initial map and ordered follow-ups by path and SHA-256.
Each follow-up binds the preceding manifest and carries the original blob/hash/
length for every rename. To resolve an original historical path, first apply the
initial map, then follow matching `oldPath` to `newPath` edges. Reject duplicate
sources, cycles or changed byte identities. The packaging regression resolves this
chain before comparing all 3,307 original blobs, exercises forged-identity/cycle
rejection, and uses the unchanged module inventory to check the archive boundary.
Future filename follow-ups must append a manifest and chain entry, not rewrite the
initial map or a previously retained manifest.

For a sparse developer checkout, include these two narrow paths in its local sparse
configuration when running the evidence-dependent tests:

```text
/planning/qualification/a05-evidence/
/planning/qualification/a05-evidence-relocations/
```

Moving screenshots does not remove the supply-chain origin requirement. The supply
gate walks qualification sources as well as shipped assets. Screenshot-origin
proposals and any unresolved source-license review must remain explicit; an oracle
license check does not establish blanket supply-catalog coverage.
