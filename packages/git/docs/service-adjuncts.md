# Repository service adjuncts

Remote requests may carry `anonymous: true` to suppress both a supplied credential ID
and the repository's configured credential. That choice is retained for lazy promisor
hydration in the same service session. Anonymous pushes fail before network access.

`createGitService` registers the local repository, Studio view, authentication,
remote and adjunct descriptors in one repository queue. Every descriptor accepts
`repositoryId` (default `default`) and the normal cancellation/progress context.
Byte results are `Uint8Array` values; worker messages preserve those values.

## Offline and maintenance operations

| Operation | Parameters | Result |
| --- | --- | --- |
| `fsck` | Optional integrity limits and `full`, `verifyPacks` | Integrity report with `ok`, categorized diagnostics, counts and statistics |
| `storageUsage` | None | Actual persisted loose/pack/index/metadata bytes and object counts |
| `repack` | Maintenance options; `prune` defaults to false | New pack ID, packed/reachable counts, pruned IDs, before/after usage |
| `gc` | Maintenance options; 14-day grace by default | Same result as repack, with reachability/grace-based pruning |
| `exportZip` | `revision` (HEAD), optional `prefix` and archive bounds | `{ bytes, entries }` |
| `importZip` | `bytes`, optional `prefix`, `stage`, `overwrite` | `{ files: [{ path, mode, size }], staged }` |
| `exportBundle` | Optional complete ref names in `refs`, size/count bounds | `{ bytes, refs, objects, algorithm }` |
| `importBundle` | `bytes`, optional `force`, `updateRefs` | Header/reference information and compact verified pack statistics |
| `policyNotices` | None | Stable ignored-setting notices with the setting name, never its executable value |

Maintenance and offline export use the underlying local object database. They do
not silently fetch a missing promisor object. A full bundle is self-contained:
export rejects shallow history and incomplete local object closure. SHA-1 uses
bundle v2; SHA-256 uses v3 with the object-format capability. Import retains the
underlying bundle prerequisite and object-closure validation.

ZIP import validates the whole archive before writing. It checks repository
paths, existing file/directory and platform case collisions, unsaved editor
buffers, and overwrite permission. It preserves executable modes when the
worktree supports them; unsupported modes fail before effects. Failure during
write/stage restores the existing repository snapshot. Rollback data is bounded
to 128 MiB by default. Shared archive limits remain 20,000 entries, 64 MiB per
file, 128 MiB expanded total and 160 MiB archive bytes. ZIP links and special
files are rejected by the shared reader. Import never treats archive contents
as repository metadata or executable configuration.

The service boundary requires a `Uint8Array` and caps imported ZIPs/bundles at
64 MiB before parsing or effects; caller size options cannot raise this cap.
ZIP export uses the active session credential redactor before compression,
retaining executable modes and recalculating CRCs and sizes after text/path
sanitization. Binary credential material rejects the export. Canonical bundle
export scans each expanded object and fails on credential material, since
changing object content would invalidate its content address.

## Sparse worktrees and LFS

`sparseCheckout` returns `{ enabled, directories, skipped }`.
`configureSparseCheckout({ directories: ['src', 'tests'] })` persists cone
patterns, config and skip-worktree index flags together. `{ disable: true }`
materializes the complete tracked tree. Modified tracked files and dirty editor
buffers are protected; write failures restore index, worktree, patterns and
config. The result lists the paths written and removed.

Every factory-created repository has a built-in local LFS clean/cache adapter.
Staging a `filter=lfs` file stores its verified SHA-256 content and stages a
canonical pointer. Smudge uses only the verified local cache; unavailable
content remains a pointer until an explicit fetch. No repository filter command,
hook, credential helper or executable alias is run.

`lfsStatus({ paths?, revision? })` returns pointer records with
`{ path, oid, size, state: 'ready' | 'missing' }`. It never downloads LFS content.
An unavailable Git object containing the pointer remains a typed object error;
the service cannot infer an LFS object ID from an absent blob.
`lfsFetch` accepts normal remote selection plus optional `paths`, `materialize`
and `force`. It downloads into the verified cache and returns compact pointer
states. Materialization protects edited files and editor buffers and rolls back
failed writes. Results never include action headers, signed action URLs or raw
remote error text.

LFS endpoint selection is explicit `lfsEndpoint`, then remote-specific `lfsurl`,
then `lfs.url`, then the Git remote's `/info/lfs` endpoint. Every batch/action URL
must have its own connection grant. Server-supplied action credentials additionally
require the exact request-local `lfsActionOrigins` array and
`lfsActionConsent: true`. This grant never authorizes forwarding the primary Git
credential. Push always finishes LFS upload/verification before receive-pack.

## Partial clones and remote writes

Stored `sharpforge/promisor` metadata is a locator, not a grant. Factory reopen
attaches a promisor database through `replaceObjectDatabase`, which invalidates
repository graph/view caches. Each lazy fetch rechecks current origin grants,
credential selection and session cancellation. It requests only missing object
IDs, without a filter, haves, reference updates or `FETCH_HEAD` writes. Same-object
concurrent reads share a request. Local fsck/maintenance stay local.

Clone cleanup restores the recorded empty destination and then refreshes live
config, index, rules, object readers and promisor state. An authentication retry
can therefore reuse the same destination. Explicit interrupted-clone retention
keeps its existing recovery/resume policy.

Force pushes use a service-owned verifier. A caller-provided function cannot
replace it. The request must contain both matching write consent and an exact
confirmation for the actual advertised old ID:

```js
{
  remoteId: 'https://git.example',
  credentialId: 'selected-session-credential',
  writeConsent: {
    confirmed: true, remoteId: 'https://git.example', scope: 'push'
  },
  leases: { 'refs/heads/main': expectedOldOid },
  confirmation: {
    confirmed: true, remoteId: 'https://git.example',
    action: 'force-with-lease', ref: 'refs/heads/main',
    expected: expectedOldOid, newOid: proposedNewOid
  }
}
```

Changing the remote, ref, either ID, action or confirmation fails. Lease mismatch
still fails before confirmation. Default `aheadBehind` resolves the current
branch's configured upstream and returns null for an unborn or unconfigured
branch; explicit local/upstream refs remain supported.

## Host capabilities

`submodules` reads inert `.gitmodules` configuration and joins definitions to
actual pinned gitlinks. `initializeSubmodules` takes optional selected `paths`
and exact `{ path, url, oid? }` records in `trustedSubmodules`. Supplying `oid`
binds trust to the exact displayed pin. Trust and network origin grants are
independent. The default factory stores child Git metadata in
`modules/<gitlink path>/` below the parent Git store and exposes a worktree
rooted at that gitlink. File System Access additionally writes the native Git
gitfile and relative core.worktree setting. KV and memory stores preserve the
same local metadata structure and worktree isolation. Foreign metadata and
nonempty unowned destinations are rejected before remote I/O.

Owned existing children reopen without another clone. Dirty-file checks precede
checkout, and the child HEAD moves only after worktree/index changes succeed,
with an exact old-HEAD comparison and rollback on failure. Parent status/add
use an explicit child-state adapter, so child files never become ordinary
parent files. Submodule listing reads persisted initialized state locally.
The host can override the default through
`submodules.createRepository({ parent, path, module, signal })`, returning a local
repository or `{ repository, initialized, dispose }`. Child disposal never closes
the parent store. A host can explicitly disable initialization with
`submodules: { createRepository: null }`, which produces an Unsupported diagnostic.
Recursive initialization remains unsupported at this
service layer until the host supplies a nested trust workflow; the lower-level
submodule API retains its bounded recursive capability.

Trusted backend settings such as an OPFS worker URL belong in
`createGitService({ repositoryOptions: { workerUrl } })`. This preserves the
service's promisor and diagnostic wiring. A custom `repositoryFactory` is an
explicit extension point whose host owns equivalent wiring. The public backend
name normalizes OPFS variants to `opfs`, while capabilities retain the actual
implementation details.

Ignored executable settings are exposed through `policyNotices` and emitted as
`onDiagnostic({ kind: 'git-policy', repositoryId, code, setting, message })`.
Trusted test hosts may opt into anonymous loopback HTTP only with service-level
`allowInsecureLocalhost: true` and an exact `localOrigins` list. A repository/RPC
parameter cannot enable it, and credential grants remain HTTPS-bound.

## Qualification

`tests/a25-service-adjuncts.test.js` covers offline import/export, both object
formats, maintenance, sparse rollback, local LFS, promisor authorization,
policy notices and submodule trust boundaries.
`tests/a25-service-remote-integration.test.js` covers partial-clone retry/lazy
fetch metadata, exact force confirmations, LFS upload ordering and independent
action credential grants, loopback policy, upstream inference and a pinned
nested clone. These deterministic fixtures use in-process HTTP responses. They
are separate from the native Git differential server fixtures.

Implementation and fixture presence are not run evidence. Execute only in the
validation owner's assigned serial batch through `scripts/limited.js` and retain
the exact source revision, command and result.
