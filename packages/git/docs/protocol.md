# Git protocols, remote operations and offline transport

`@sharpforge/git` provides explicit asynchronous repository, transport and credential boundaries. Its wire implementation is independent of hosting APIs and of the Studio UI. Objects are content addressed; references become visible after object verification. No module invokes a Git executable, shell hook, credential helper or external filter at runtime.

## Entry points

| Capability | Public entry points |
| --- | --- |
| Packet framing | `encodePktLine`, `encodePackets`, `PktLineDecoder`, `decodePktLines`, `decodeSideband`, `PacketKind` |
| Remote discovery | `discoverRemote`, `listRemoteRefs`, `parseAdvertisement` |
| Upload-pack | `fetchPack`, `negotiateFetch`, `buildV1FetchRequest`, `buildV2Command` |
| Pack decoding | `readPack`, `applyDelta`, `createPackReader`, `IndexedPackReader` |
| Pack creation | `writePack`, `writePackStream`, `createDelta` |
| Pack indexes | `writePackIndex`, `readPackIndex`, `MultiPackIndex` |
| Remote operations | `cloneRepository`, `fetchRemote`, `pushRemote`, `recoverClone` |
| Refspecs and remotes | `parseRefspec`, `mapFetchRefs`, `prunableRefs`, `RemoteManager`, `setRemoteRef`, `deleteRemoteRef` |
| Shallow and partial clones | `parseShallow`, `encodeShallow`, `updateShallow`, `PromisorDatabase`, `validateFilter` |
| HTTP and REST | `HttpGitTransport`, `createHttpTransport`, `RestGitTransport` |
| Large files | `parseLfsPointer`, `encodeLfsPointer`, `LfsClient`, `LfsUploadClient`, `cleanLfs` |
| Repository adjuncts | `discoverSubmodules`, `initializeSubmodules`, `SparseCheckout`, `applySparseCheckout` |
| Maintenance | `repositoryStorageUsage`, `repackRepository`, `gcRepository`, `pruneRepository` |
| Offline interchange | `exportTreeZip`, `readBundle`, `importBundle` |

The base remote options are:

```js
{
  odb,                  // async write(type, bytes), read(oid), has(oid), list()
  refs,                 // async read/resolve/list plus CAS transaction(updates)
  config,               // optional GitConfig, required for persisted upstream config
  worktree,             // optional adapter; clone requires an initially empty tree
  transport,            // request({url, method, headers, body, signal}) -> Response
  url,
  algorithm: 'sha1',    // or sha256; never silently translated
  signal,
  onProgress            // receives phase, completed, total, bytes or remote message
}
```

The core ODB returns `{oid, type, data, size}`. `refs.read(name)` returns an OID or `null`; `refs.resolve(name)` returns `{ref, oid}`. Reference transactions use `{name, oid, expected}`; `null` deletes a ref. Remote operations retain old IDs and do not silently overwrite a concurrently changed reference.

## Smart HTTP

Discovery requests `Git-Protocol: version=2`. Version 2 capabilities and `ls-refs` provide named refs, peeled annotated tags, symbolic HEAD and unborn HEAD. Version 0/1 advertisements retain capabilities attached to the first ref. Format disagreement fails before pack parsing.

Fetch supports want/have/done, bounded negotiation rounds, shallow/deepen/deepen-since/deepen-not/deepen-relative/unshallow, filtered fetch and include-tag. With v2 `wait-for-done`, early rounds obtain acknowledgments without consuming a premature pack. Other v2 servers receive a complete final round. The response reader retains section state while yielding sideband channel-one pack bytes; channel two reports progress and channel three fails with the remote error.

`fetchRemote` maps configured refspecs, respects negative exclusions, follows available tags and prunes only refs owned by the positive mappings. Fetched commits/trees/tags are checked for object-graph completeness. Shallow parents and specifically permitted missing blob/tree objects are explicit exceptions, returned as promised-object metadata. References are updated only after pack checksum and graph verification.

`pushRemote` computes objects reachable from outgoing tips but absent from known remote reachability, emits a PACK v2, and sends receive-pack commands with advertised old IDs. It supports status-v1/v2, nested sideband status, atomic updates, push options and deletions. Delete-only operations omit the pack, as required by the protocol. Every requested ref must have one server status result.

Non-fast-forward branch changes and tag replacement require force intent or an exact force-with-lease value. They also require a confirmation token accepted by the caller's `verifyConfirmation` callback for the exact ref, current OID and new OID. Server rules remain authoritative, and rejected-ref diagnostics retain the server message. Plain force is not authorized by a Boolean alone.

## Origin and credential boundaries

```js
const transport = new HttpGitTransport({
  origins: ['https://git.example.test'],
  credentialOrigins: ['https://git.example.test'],
  credentialProvider: async ({origin, signal}) => ({
    headers: await authorizedHeadersFor(origin, signal)
  }),
  onCredentialOrigin: event => auditWithoutSecrets(event),
  onScopes: scopes => recordObservedScopes(scopes)
});
```

`origins` authorizes a request; `credentialOrigins` separately authorizes credential disclosure. `requireOrigin(origin,{purpose,credentials})` can implement the same checks through the application's grant service. The auth context supplies this adapter. A proxy requires both upstream and proxy request grants, plus separate credential consent for each credential recipient. The credential-origin event contains origins only. `onScopes` is invoked only for an actually present `X-OAuth-Scopes` response header on a request that sent the repository credential provider's Authorization header. An LFS action host cannot assert repository-token scopes.

There is no preconfigured public proxy. URLs containing username/password material, fragments, unsupported schemes or disallowed origins fail before a request. HTTPS is required; explicit `allowInsecureLocalhost` supports loopback conformance servers. Redirect following and cookies are disabled. The abort/deadline signal remains connected until the streamed response body finishes or is cancelled.

`packages/git/proxy/server.js` exports `createGitProxy(options)`, returning an ordinary Node `http.Server`. Its explicit allow-lists are full upstream/client origins. It accepts only smart Git `info/refs` discovery and upload-pack/receive-pack POST paths, filters request headers, bounds transfer bodies and does not log credentials. It is a local or self-hosted reference implementation; production deployment policy remains the host application's responsibility.

`RestGitTransport` accepts providers with `listRefs`, `getObject`, `writeObject`, `updateRefs` and `getCapabilities`. Canonical transfer requires `canonicalObjects: true` and matching `objectFormat`; atomic push requires `atomicPush: true`. Metadata-only REST providers may reconstruct a snapshot through their provider APIs, but cannot promise byte-identical original commit headers/signatures. The canonical transport returns `Unsupported` for those providers instead of fabricating original OIDs.

## Pack formats and resource bounds

The parser reads PACK v2/v3, validates variable-length object sizes, zlib checksums, OFS/REF delta operands and the trailing SHA-1 or SHA-256 pack checksum. Metadata retains offsets, CRC32, object type, size and chain depth. OFS bases must point backwards into the same pack. REF bases may resolve later in the pack or through an existing ODB. Waiting deltas use dependency maps and optional staging storage; resolution does not repeatedly scan the whole pending set.

`readPack(stream,{odb,staging})` stores canonical objects as the stream progresses. A checksum failure cannot move refs; unreachable objects are eligible for cleanup. For an empty destination, clone recovery restores the complete destination baseline. Direct parser callers that need isolated ingestion should provide a staging ODB and publish it after success.

Pack response closure is attempted even if staging cleanup fails. If both reading and
cleanup fail, the error retains the original read code and message, with the original
error as `cause`, all original errors in `errors`, and JSON-safe cleanup diagnostics
in `details.cleanupErrors`. A cleanup failure cannot silently replace a receive failure
or leave the response deadline active merely because the staging store rejected deletion.

IDX2 supports cumulative fanout, sorted object IDs, CRC32, 32-bit offsets, 64-bit offset tables, pack checksum and index checksum. The reader rejects malformed fanout/order/table bounds. Offsets above JavaScript's exact integer range are returned as `BigInt`; an in-memory pack accessor rejects offsets outside its actual byte array. `createPackReader` verifies the complete pack/index pair; reads additionally verify object CRC and content-address identity. `MultiPackIndex` provides an explicit pack registration map, separate from Git's on-disk MIDX file format.

`writePackStream` retains a bounded sliding window of same-type objects, uses bounded block matching for OFS deltas and compares compressed candidate sizes. Its checksum and entry CRC are incremental. `writePack` collects that stream when an in-memory request is appropriate. Browser push currently uses a bounded request buffer because request-stream support and proxy support vary; fetch pack data stays streaming.

Default bounds are deliberate:

| Resource | Default |
| --- | ---: |
| Encoded pkt-line | 65,520 bytes |
| Advertised refs / pack objects | 1,000,000 |
| Individual decoded object | 64 MiB |
| Pack compressed read window | 72 MiB |
| Pack decoder total input | 4 GiB |
| Delta chain depth | 128 |
| Writer delta window | 10 objects / 16 MiB |
| Indexed-reader decoded cache | 8 MiB |
| In-memory pack/push buffer | 256 MiB |
| Promisor batch | 512 OIDs |
| LFS batch / concurrency | 100 objects / 4 downloads |

The read window and decoded object buffers are separate allocations. These limits are not a claim that total memory is always below one object limit. Large-fixture peak memory and timing are qualification measurements, recorded by the benchmark harness, not inferred from source structure.

## Clone cancellation and recovery

`cloneRepository` accepts an initially empty ODB/ref namespace and empty worktree, with an optional preinitialized empty-repository baseline. It records `sharpforge/clone-journal` before effects. Ten named checkpoints cover creation, fetch, verification, ref planning/publication, HEAD, config, checkout, completion and journal cleanup.

Ordinary failure/cancellation restores the baseline transactionally and removes materialized worktree files. Abrupt process termination leaves the journal; reopening must either call `recoverClone({odb,worktree})` or resume the matching clone before exposing a ready repository. A persisted verified checkpoint resumes from complete objects without fetching the pack again. A partial receive is cleared and refetched. `retainInterrupted` exists for hosts/tests that intentionally preserve a failed operation for resume. Checkpoint callbacks are an injection seam for deterministic crash tests.

Checkout is injected as `checkout({odb,refs,worktree,oid,ref,signal,...})`; the package's working-tree layer supplies it. Clone to an explicit tag checks out detached HEAD. Config records the remote fetch refspec and branch upstream for branch checkouts.

## LFS, submodules and sparse checkout

LFS pointers use the v1 pointer syntax and SHA-256 identity. Clean writes binary data to the explicit cache and returns pointer bytes. The batch/basic client verifies requested object IDs, exact lengths and SHA-256 before caching or materializing data. Missing server objects return `{state:'missing',pointer,message}` for a visible UI placeholder. Tampered content fails. Upload deduplicates outgoing pointer IDs, uploads binaries before the Git push and executes optional verify actions. Action URLs receive separate origin grants; the original Git credential provider is disabled for those URLs. Shell LFS extensions are not executed.

`.gitmodules` is parsed as inert config. Paths are validated by the shared checkout-path policy and URL resolution rejects filesystem/unsupported transports. Each exact submodule URL requires trust before creating a nested repository, and each origin obtains its own transport. Untrusted entries stay uninitialized. The pinned gitlink commit is fetched when necessary and checked out detached; recursion has explicit depth and cycle bounds. A trusted host descriptor can set `initialized: true` to reuse an existing child with a valid commit HEAD. The `checkout` callback changes only worktree/index state and may return `{rollback}`; the initializer then publishes detached HEAD by compare-and-swap and invokes rollback if that publication fails. Repository content cannot set the reuse flag.

Cone-mode sparse checkout includes root files, files directly within selected directories' ancestors and all selected subtrees. Canonical cone patterns roundtrip through `SparseCheckout`. Application validates all removals before effects, refuses dirty removals unless explicitly forced, batches missing promised blobs and maintains the index `skipWorktree` bits. The working-tree status engine ignores skipped paths.

## Maintenance and archives

Maintenance roots include live refs, HEAD, index entries, reflog entries and optional caller roots. Unreachable objects respect an explicit grace period. Backends without object timestamps use a conservative first-observed-unreachable ledger; an unknown-age object receives the current maintenance timestamp. Retained recent objects also retain their reachable dependencies.

Repack prepares a verified self-contained pack/index pair, then compares reference/index/pack state within the publishing transaction. Concurrent changes abort rather than pruning a newer repository state. The transaction replaces pack files and removes redundant loose copies/expired unreachable objects; the ODB's registered pack readers change only after the transaction succeeds. Storage reporting measures persisted bytes by category.

ZIP export walks the selected tree, applies committed `.gitattributes` `export-ignore`, reuses `@sharpforge/archive`, and preserves Unix executable/symlink modes in the central directory. It exports symlink target bytes without following links. Non-UTF-8/nonportable paths fail explicitly. Submodule directory entries do not include nested repository contents.

Git bundles v2/v3 are offline sources. Header parsing is bounded while pack bytes remain streaming. SHA-256 `object-format` and supported `filter` capabilities are interpreted; unknown required capabilities fail. Prerequisites must already exist. Pack and graph validation precede reference updates. Existing different refs require explicit force for bundle import.

## Qualification and reference sources

Focused tests are split by wire framing, packs, transports, remote policy, adjuncts and archive/maintenance. They include malformed/boundary/cancellation cases, deterministic packet fuzz inputs, 50-deep delta chains, SHA-1/SHA-256 pack paths, native `git index-pack --strict` and IDX2 comparison, native bundle import/archive listing, explicit origin policy, 50-pack consolidation and LFS tamper checks. Native HTTP, broader differential, browser storage, large-fixture memory and worker-cancellation qualification are separate harnesses. A test being present is not evidence that a backend or scale target has passed; validation is run after the complete scope is integrated.

Primary format sources used for these implementations:

- [Git pack format](https://git-scm.com/docs/gitformat-pack)
- [Git protocol v2](https://git-scm.com/docs/gitprotocol-v2)
- [Git pack transfer protocol](https://git-scm.com/docs/gitprotocol-pack)
- [Git bundle format](https://git-scm.com/docs/gitformat-bundle)
- [Git sparse checkout](https://git-scm.com/docs/git-sparse-checkout)
- [Git LFS batch API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md)
- [Git LFS basic transfer API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/basic-transfers.md)
