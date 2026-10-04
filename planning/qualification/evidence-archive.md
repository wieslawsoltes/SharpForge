# Historical evidence migration (SF-A29-T37)

The reviewed inventory in `evidence-archive.json` selects 89 generated JSON,
TAP, text and DLL reports from `docs/`. It retains authored API/reference data,
the A05 planning scope, the A20 capability ledger, the keyboard-shortcut reference,
Markdown and screenshot illustrations. The archive
preserves every selected byte, including old filenames, timestamps, embedded
source references and qualification claims. It does not infer tested revisions,
repair old reports or qualify any target. The snapshot commit identifies the
archived files, not necessarily the software originally tested.

The repository had no published GitHub releases when this migration was prepared.
Use a new non-version tag such as `evidence-archive-2026-10-03`, pinned to the
exact published tooling commit while the originals are still present. It must
include the archival exclusion in `repro.yml`. Publish as a prerelease with
`--latest=false`; do not invent versioned historical releases or reuse a tag.

## Prepare and review

After committing and publishing the tooling, record its full commit SHA and use
a new staging directory whose parent already exists:

```sh
node scripts/conformance/archive-evidence.js --mode prepare \
  --commit FULL_40_CHARACTER_SHA --tag evidence-archive-2026-10-03 \
  --stage /tmp/sharpforge-historical-evidence
```

This reads committed Git blobs and checks the current originals still match. It
stages 92 upload assets: 89 individual reports, `HISTORICAL-EVIDENCE.json`,
`historical-evidence.zip` and `SHA256SUMS`. The ZIP uses the existing bounded,
deterministic archive package and preserves original `docs/` paths. The
manifest contains the snapshot commit, original Git blob IDs, policy digest,
sizes, SHA-256 hashes, retained license declarations and proposed asset URLs. Those URLs are proposals until
publication and download verification succeed.

Review `MIGRATION-PLAN.json` for the exact proposed removals, rewritten Markdown
contents, original content hashes and complete index. Review `RELEASE-NOTES.md`
and `UPLOAD-PLAN.json`; the latter contains an exact `gh` argument array and
prepublication checks, not a shell command. Preparation never edits originals
and refuses an existing staging directory or evidence index.

A local Markdown link that names a selected evidence path but climbs outside
the repository is rejected with its document path and target. Correct that link
in its owning document before preparing or migrating; the tool does not guess
the intended destination. Unrelated links outside the repository are unchanged.

The inventory includes the PDB interoperability and performance reports and the
A20 search benchmark added after the initial 86-report proposal. That earlier staging directory retains its
original snapshot and must not be relabeled or reused with the expanded policy.
Prepare a new directory from a published commit containing all 89 reports and
this policy; review the newly generated consumer rewrites against that checkout.

The A20 search benchmark contains recorded command, machine and timing data;
archive its original bytes without rerunning or reinterpreting the measurements.
The A20 coverage file is an authored capability/acceptance ledger with historical
validation context and deferred integration. The Visual Studio inventory is an
authored shortcut reference. Both remain in `docs/` with explicit preservation
reasons; their inclusion does not claim fresh validation.

## Publish, verify, then migrate

Check both API paths listed in `absentBeforePublication`. Both must return 404;
any existing tag/release or other error stops publication. Review the source pin
and execute `gh` with the plan's argument array. This creates one new archival
prerelease and uploads the enumerated files without replacing existing assets.
Do not pass `--clobber`, delete a partial upload, or move a tag to repair a
failure. Originals remain available while a partial publication is investigated.

```sh
node scripts/conformance/archive-evidence.js --mode verify \
  --stage /tmp/sharpforge-historical-evidence
node scripts/conformance/archive-evidence.js --mode migrate \
  --stage /tmp/sharpforge-historical-evidence
```

Verification reconstructs every staged asset from the exact Git snapshot and
reviewed policy. It resolves the published tag (including bounded annotated-tag
chains), checks the prerelease's exact uploaded asset inventory, and anonymously
downloads every public asset to compare lengths and SHA-256 digests. Merely
having a release URL, HTTP success or GitHub digest metadata is insufficient.

Migration repeats live verification and rechecks originals and Markdown after
downloads. Only then does it create `docs/historical-evidence.md`, rewrite local
Markdown links, append index notices for plain filename references, and remove
the verified originals. The active supply license inventory drops the archived
DLL entry only after its full declaration and source-policy pin are retained in
the manifest; other declarations are unchanged. Report contents and internal historical JSON references
remain unchanged in assets; related relative paths still work inside the ZIP.
Verification receipts stay in the staging directory. Commit the resulting
source migration separately, review its diff, and check all index URLs.

The old `planning/contracts/golden-output.lock.json` intentionally remains an
honest historical baseline. Removing these files changes `dist/docs/` inventory;
this migration is not a seam-preserving change and does not regenerate or claim
to pass that old baseline. Its raw report references remain resolvable inside
the ZIP. The existing supply SBOM and browser-build manifests also remain
unaltered historical evidence. A later intentional baseline update requires
separate measured review.

## Bounds and support

There are no added dependencies. Git operations are shell-free, time-bounded,
and explicitly ignore local replacement objects so source pins identify real bytes.
The tool limits entries to 256 (including the manifest), each input to 8 MiB,
total archive content to 32 MiB, and ZIP bytes to 40 MiB. Network requests have a
30-second deadline, the verification operation a 10-minute deadline, and total
downloads a 96 MiB limit. Redirects are limited to three and allowed GitHub asset
hosts over HTTPS. Local symlinks, traversal, unknown data files, changed blobs,
duplicates, missing assets and oversized streams fail closed.

Focused tests use temporary Git repositories and fake HTTP responses; they never
contact GitHub or change tracked files. This is Node-hosted archival tooling.
Source VM, direct CIL, CLR, Rust native/Wasm and browser engines are not executed
or requalified. Linux/Windows portability and live publication must be recorded
from actual runs, never inferred from offline tests on another platform.

The three remaining benchmark producers now use `resultPath` and default to
`artifacts/results/`; `SHARPFORGE_RESULTS_DIR` remains supported. All three retain
their explicit `BENCH_REPORT` override. Measurements and report schemas do
not change.
