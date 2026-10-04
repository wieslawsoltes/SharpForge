# Live collaboration

`@sharpforge/git` contains an independent document collaboration service. It shares
the package's diagnostics and the host's origin and credential services. Live
document updates do not create Git objects, mutate repository refs, or implement
Git push/pull. A workspace may use live editing without configuring a Git remote.

Tracking: [SF-A25-T11](https://github.com/wieslawsoltes/SharpForge/issues/355),
[T20](https://github.com/wieslawsoltes/SharpForge/issues/2069),
[T21](https://github.com/wieslawsoltes/SharpForge/issues/2070), and
[T22](https://github.com/wieslawsoltes/SharpForge/issues/2071).

## Capability inventory

| Contract | Implementation and positive gate | Boundaries |
| --- | --- | --- |
| `SequenceCrdt` | Stable UTF-16 atom IDs; indexed RGA insertion/deletion; three replicas with 10,000 seeded random edits checked against a separate specification model | Append-only causal history; explicit quotas; no unsafe tombstone collection |
| Snapshot/update encoding | Version 1 JSON encoded as UTF-8; preserves individual UTF-16 surrogate units; duplicate operations are idempotent | Unknown versions, malformed IDs, identity conflicts and resource overflows are diagnostics |
| `WebSocketCollabTransport` | Token authentication, exact origin grant, heartbeat, bounded reconnect/backoff and cancellation | Requires a real WebSocket implementation; WSS in production; WS only with explicit loopback opt-in |
| `WebRtcCollabTransport` | Authenticated SDP signaling, deterministic offer ownership, DTLS data channel with fragmented messages and durable WebSocket recovery | Requires native `RTCPeerConnection`; no implicit public STUN/TURN service; unavailable native API is `Unsupported` |
| `CollabRoomServer` | Workspace/room/document isolation, read/write grants, actor ownership, seed CAS, durable append before ACK, presence and signaling | One authority owns each room; multi-process storage needs a transactional room owner and fencing supplied by the host |
| `CollabSession` | Immediate local edits, transactional pending outbox, full history reconciliation, canceled sync and controlled disposal | A pending edit is sent only after local journal commit; quota failures remain visibly unsaved |
| `IndexedDbCollaborationPersistence` | Per-workspace/room/document/actor journal and outbox; reload restores both text and pending flags | Browser IndexedDB required; unavailable or failed storage is an explicit error; never silently falls back to volatile storage |
| Studio presence and editor binding | Accessible peer list, stable remote selections, status/retry, existing document notifications, explicit create/join dialog | Captures the exact workspace and source editor; classic Vim/Emacs/Sublime surfaces produce `Unsupported` |
| Node reference service | HTTP/HTTPS upgrade with exact Origin allowlist; RFC 6455 masking/fragments/control frames; fsync journal | Optional Node adapter; never imported into the browser entry point; single-server journal |

The implementation runs in the host JavaScript engine. CIL, CLR, Rust and Wasm
managed execution engines do not execute this browser/Node service and are not
claimed as additional backends. Native Node WebSocket qualification is separate
from deterministic socket contract fixtures. Browser qualification must run the
actual Python Playwright scenario below on each named engine; fixture adapters
cannot establish Chromium, Firefox or WebKit support. A missing browser executable
is an unavailable target, never a passing result.

## Document model and public API

```js
import {
  SequenceCrdt, encodeCollaborationUpdate, decodeCollaborationUpdate,
  encodeCollaborationSnapshot, decodeCollaborationSnapshot
} from '@sharpforge/git';

const text = new SequenceCrdt({
  actorId: 'unique-replica', workspaceId: 'workspace', documentId: 'Program.cs'
});
const update = text.insert(0, 'class Program {}\r\n');
text.replace(6, 7, 'Example');
const anchor = text.anchorAt(6, 'right');
const offset = text.resolveAnchor(anchor);
const source = text.toSourceText('Program.cs'); // @sharpforge/text SourceText
const receiver = new SequenceCrdt({ actorId: 'another-replica', workspaceId: 'workspace', documentId: 'Program.cs' });
receiver.apply(decodeCollaborationUpdate(encodeCollaborationUpdate(update)));
await receiver.mergeSnapshot(decodeCollaborationSnapshot(encodeCollaborationSnapshot(text.snapshot())));
```

`insert(offset, text)`, `delete(offset, count)` and
`replace(offset, deleteCount, text)` return an immutable update, or `null` for an
empty edit. Offsets, deletion counts, selections and source locations use UTF-16
code units, matching browser editors and `SourceText`. They are not UTF-8 byte
offsets or Unicode grapheme indices. CRLF and split surrogate units round-trip
exactly through version 1 encoding.

`apply(update, { local: false })` validates a complete transaction before mutation.
It returns `true` for a new operation and `false` for an identical replay. Reusing
an operation/atom ID with different content is `Conflict`; a foreign workspace or
document is `Auth`. `prepareUpdate(update)` performs the same preflight without
mutation and returns `{ update, byteLength, duplicate }`; the authority uses this
before durable storage. A server must serialize preparation, persistence and
application for a room, as `CollabRoomServer` does.

`subscribe(listener)` returns an unsubscribe function. Change events contain
`{ type, local, update, changes, revision }`. Each change is
`{ start, deleteCount, insertText }` in sequential coordinates: apply the first
range, then apply the next range to that resulting text. Snapshot events replace
the visible document in one published transaction. `text`, `length`, `revision`
and `stats` are read-only views. `dispose()` releases stored history and listeners
and rejects later editing operations with `Disposed`.

`anchorAt(offset, bias)` stores the neighboring stable IDs. Left bias stays
before inserts at that boundary; right bias follows them. A tombstoned neighbor
retains its structural position. `resolveAnchor` returns `null` while referenced
remote IDs have not arrived, avoiding a guessed cursor position.

### Ordering, complexity and retention

The sequence follows the replicated growable array family: an atom points to its
causal predecessor, and concurrent siblings sort by descending Lamport clock and
then descending actor ID. Atom IDs are `actor:positiveClock`; one insert run uses
consecutive clocks and a predecessor chain. Updates never point an inserted atom
at an equal or newer clock, so malformed cyclic ancestry is rejected before
mutation. Deletes can arrive before inserts and children can arrive before parents.
Pending atoms attach when their parent becomes available. Duplicate delivery and
arbitrary causal delivery order produce the same visible traversal.

Each atom has a start/end marker in an implicit AVL tree with visible UTF-16
weights. A second AVL index orders children of each insertion anchor. Offset
lookup, cursor resolution and individual marker insertion are `O(log n)`; editing
`k` units costs `O(k log n)` including changes emitted to the host. Reading `text`
materializes `O(n)` visible units and caches the result until a visible edit.
Tombstone-only subtrees are skipped by weighted navigation. Snapshot construction
sorts operations in canonical clock/actor order (`O(m log m)`); union stages a
separate validated document, yields between operation batches and publishes only
after success. Concurrent local edits entered during staging are retained. Abort
leaves the original document intact.

History/tombstones are retained so arbitrary offline replicas can safely return.
There is no claim of bounded-history garbage collection without replica knowledge.
At quota, callers receive `Limit` and the old document remains intact. Export and
start a new explicitly identified room to reset history; do not erase tombstones
inside an existing shared room.

The design references the RGA/sequence CRDT literature in
[Shapiro et al., A comprehensive study of CRDTs](https://pages.lip6.fr/Marc.Shapiro/papers/Comprehensive-CRDTs-RR7506-2011-01.pdf).
Browser data-channel behavior follows the [W3C WebRTC API](https://www.w3.org/TR/webrtc/)
and WebSocket framing follows [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455).
The AVL indices and protocol implementation here are local, dependency-free code.

## Session, identity and persistence

```js
import {
  SequenceCrdt, CollabSession, WebSocketCollabTransport,
  IndexedDbCollaborationPersistence, acquireCollaborationClient
} from '@sharpforge/git';

const scope = { workspaceId: 'workspace', roomId: 'team', documentId: 'Program.cs' };
const lease = await acquireCollaborationClient(scope);
const identity = { ...scope, clientId: lease.clientId };
const document = new SequenceCrdt({ ...identity, actorId: identity.clientId });
const transport = new WebSocketCollabTransport({
  identity, url: endpoint,
  assertOrigin: url => grants.assert(url, { remoteId: 'live:team' }),
  tokenProvider: () => vault.get(credentialId, { origin: new URL(endpoint).origin }).then(record => record.accessToken)
});
const session = new CollabSession({
  identity, document, transport,
  persistence: new IndexedDbCollaborationPersistence(),
  profile: { name: 'Editor', color: '#275dad' },
  initializeText: currentEditorText // omit to explicitly join an existing room
});
await session.start();            // local restoration completes even while offline
await session.replace(0, 0, '// '); // durable local commit, not a server ACK
session.setPresence({ anchor: 3, focus: 3 });
// On document close:
await session.dispose();
lease.release();
```

All four identity parts are explicit, case-sensitive ASCII identifiers of 1–128
characters (`A–Z`, `a–z`, digits, `_`, `.`, `@`, `-`). A host maps arbitrary file URIs
or paths to stable IDs; the display name/path may remain separate. A server room is
keyed by workspace, room and document. Persistence adds the actor/client ID to
that key. A text update carries workspace/document scope; only the authenticated
room transport may decide where it is delivered.

One actor must have one active writer. `acquireCollaborationClient` uses a random
UUID, per-tab session storage and an exclusive Web Lock. A reload keeps the actor;
a cloned tab with a copied actor forks to a new ID when the lock is held. Its
return value is `{ clientId, release }`. If secure randomness, Web Locks or session
storage are unavailable, this automatic identity path is `Unsupported`. A host may
provide its own uniquely owned, reload-stable `clientId` instead. The authority
independently rejects two live connections using the same actor ID in one room.

`session.status` includes `loaded`, `connected`, `synchronized`, `pending`,
`unsaved`, `persistent`, `storageError` and `state`. Local editing is synchronous after restoration;
its promise resolves when the journal commits the operation and pending flag in
one transaction. Network sends wait for that commit. An ACK clears the pending
flag in another transaction before the entry leaves the in-memory outbox.
`retryPendingPersistence()` retries visible unsaved edits; `whenIdle()` awaits
currently queued journal work. Disposal aborts sync/auth, removes subscriptions
and timers, closes transports and waits for already accepted journal transactions.
An externally supplied persistence provider remains host-owned unless
`ownPersistence: true` is passed. `ownDocument` controls document disposal likewise.

`storageError` also tracks failed persistence of incoming shared updates. The view
does not claim those changes are saved on the device; retry performs full history
reconciliation and clears the flag only after the journal commits successfully.

IndexedDB uses version 1 stores `documents` and `operations`, with a by-document
index. Opening, transaction, quota, metadata corruption and blocked upgrade
failures are explicit. The default database name is
`sharpforge-collaboration-v1`; callers may choose another name. Tokens, SDP,
presence and cursor positions are not persisted. `MemoryCollaborationPersistence`
is available for deliberately ephemeral sessions and reports `persistent: false`.

### Creating a room from existing code

`initializeText` creates a locally durable initial operation. The authority's
`initialize` transaction accepts it only while the room is empty, or when that
exact operation is already present after a reconnect. Another creator receives a
conflict, keeps its local text and pending operations, and never appends a second
copy of the initial file. Initialization intent is stored with the operation and
survives reload; changing the UI mode cannot silently bypass that guard.

After a conflict, select another room or intentionally export/discard that local
journal through the persistence provider's explicit `clear(identity)` operation
before joining a different document. A host must obtain the user's decision before
discarding pending edits. Joining an existing room replaces the editor buffer with
the shared document, and Studio's setup dialog states this explicitly.

## Transport and server contract

Authentication is the first WebSocket frame. The URL has no credentials, query or
fragment. The token is obtained only after the explicit origin grant succeeds,
is limited to 8,192 characters, and is never included in logs, persisted operations
or diagnostics. `tokenProvider({ identity, signal })` may fetch/refresh a room
credential. Prefer dedicated room credentials with scope/expiry over reusing a Git
provider PAT. A server-provided URL or ICE candidate never creates an origin grant.
The host must both grant the endpoint and allow it through its shipped CSP.

The authority requires `authorize({ token, identity, signal, context })` to return
`{ identity, permissions: { read: true, write: boolean }, expiresAt? }` with the exact
requested identity. Authentication happens before room storage is loaded and before
any peer/document information is disclosed. Expiry closes the connection and aborts
pending auth. Read-only clients can receive text/presence but cannot publish edits.
An operation's actor must match its authenticated client. Server error messages
are fixed public diagnostics; adapter errors are not echoed.

`CollabRoomServer.attach({ send(text), close(code, reason), context? })` returns
`{ receive(data), close() }`. The socket adapter must pass UTF-8 text/bytes to
`receive`, own its transport lifecycle and call `close` when the peer leaves. The
authority serializes per-room writes and sends an ACK only after
`persistence.append(identity, update)` succeeds. A provider also implements
`load(identity)`, returning a snapshot or `null`. The optional Node adapter supplies
real RFC 6455 framing and enforces its own browser Origin allowlist.

Reconnect obtains a fresh credential, rechecks the grant and requests a complete
bounded snapshot. Snapshot batches and live updates may interleave; CRDT union
handles their causal order. Missing local operations are requeued; server history
containing an operation acts as an implicit ACK after an ambiguous disconnect.
Backoff defaults to 250 ms through 30 s with 20% jitter. Heartbeats default to 15 s
with a 10 s reply deadline. Authentication, identity, corruption, unavailable native
APIs and unsafe-origin errors block automatic retry; explicit `reconnect()` follows
a host credential/grant correction.

For direct editing, construct `WebRtcCollabTransport({ signaling, RTCPeerConnection?,
rtcConfiguration?, assertIceServer?, autoConnect?, maxPeers? })` around the authenticated
WebSocket transport. It retains the same `start`, `send`, `subscribe`, `reconnect`,
`dispose`, `identity`, `state` and `connected` contracts. `start()` awaits asynchronous
ICE grants before opening signaling. Every configured STUN/TURN URL requires an
explicit `assertIceServer(url)` callback; the default configuration has no external
ICE servers. NAT traversal may therefore need host-approved TURN configuration.

The lower lexical actor owns offer creation; the other requests it through the
authority. SDP and candidates go only to authenticated peers in the same room.
The data channel checks both identities and its signaled session before accepting
updates. Direct updates must be from a writable peer and match its actor ID. The
WebSocket authority still receives every edit for durability/ACKs; direct delivery
can win the latency race and duplicate arrival is harmless. Loss of authenticated
signaling disposes the corresponding peer connections. `metrics` reports
`directSent`, `directReceived`, `fallbackSent` and `connectedPeers` so qualification
can prove that actual data channels were exercised.
`diagnostics` snapshots each peer's connection, ICE, signaling and channel state,
candidate counts and last numeric ICE error. They omit SDP, candidate addresses,
ICE passwords and server credentials. Peer open/close events retain the same state
snapshot so a failed connection can be diagnosed after disposal.

The native browser fixture explicitly enables Chromium's
[`--allow-loopback-in-peer-connection`](https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc)
to include the real loopback interface when the test container has no other
network interface. The shared launcher defaults to no such option. The fixture
records this option and the available interface names/families, preserves native
ICE/DTLS/SCTP and retains peer snapshots on failure. This local qualification does
not establish traversal through an external NAT or TURN service.

The default `python tests/a25_collab_browser_test.py` requires a native direct
WebRTC channel; unavailable ICE candidates remain a failed qualification. An
explicit `--scope websocket-fallback` runs the production WebSocket transport
through the same two-browser typing, cursors, offline IndexedDB reload, reconnect,
room authorization and disposal scenario. It counts actual browser WebSocket
update and ACK frames, without modifying native transports. Its separate
`a25_collab_browser_websocket_fallback/qualification.json` always records
`fullScope: false` and `fullScopePassed: false`; a successful fallback result does
not qualify direct WebRTC. The area-manifest entry point keeps the full scope by
default and never substitutes a fallback run automatically.

### Runnable Node service

After installing the workspace's existing dependencies, set a strong room secret
through your environment/secret manager and run:

```sh
node packages/git/collab-server/example.js
```

The required environment variable is `SHARPFORGE_COLLAB_ROOM_TOKEN` (at least 32
random characters). Optional metadata variables are `SHARPFORGE_COLLAB_WORKSPACE`,
`SHARPFORGE_COLLAB_ROOM`, `SHARPFORGE_COLLAB_DOCUMENT`, `SHARPFORGE_COLLAB_ORIGINS`
(comma-separated exact browser origins), `SHARPFORGE_COLLAB_PORT`,
`SHARPFORGE_COLLAB_ADDRESS`, and `SHARPFORGE_COLLAB_JOURNAL`. TLS can use
`SHARPFORGE_COLLAB_TLS_CERT`/`SHARPFORGE_COLLAB_TLS_KEY` paths. Non-loopback listeners
require TLS. Default loopback HTTP can sit behind a trusted TLS reverse proxy or
serve explicitly opted-in local development. Missing browser Origin is denied.

The fsync journal is keyed by a hash of workspace/room/document, not by untrusted
paths. Corrupt/incomplete records fail closed instead of resetting the document.
This reference provider assumes one server process owns each room; shared-network
files are not a distributed locking mechanism.

## Studio host hooks

`apps/studio/git-collab-setup.js` exports async
`createStudioCollaboration(host, options)` and
`showCollaborationSetup(host, options)`. The factory returns
`{ identity, document, session, transport, view, start, dispose }`, owns the automatic
client lease and defaults to IndexedDB plus creating a room from `host.getText()`.
Use `mode: 'join'` for an intentional remote-buffer replacement; `initializeText`
can explicitly supply a new room's content. `transport: 'webrtc'` enables direct
connections. An explicitly supplied `identity.clientId` bypasses automatic tab
identity provisioning when the host owns that responsibility.

| Host hook | Contract |
| --- | --- |
| `element` | Existing DOM container; its `ownerDocument` creates the view |
| `getText()` | Current editor text |
| `onTextChange(listener)` | Subscribe to `{ start, deleteCount, insertText }`; return an unsubscribe function |
| `applyRemoteTextChange(change)` | Apply one range; the binding suppresses synchronous editor echo |
| `getSelection()` / `setSelection(selection)` | UTF-16 `{ anchor, focus }` |
| `onSelectionChange(listener)` | Subscribe to selection changes; return unsubscribe |
| `setRemoteCursors(peers)` | Render stable resolved selections; `null` positions mean causal IDs are still missing |
| `announce(message)` | Optional host status/assistive announcement |

The dialog accepts `assertOrigin`, `tokenProvider` and optional
`requestOriginGrant` from the existing permission/credential services. A manually
entered token remains in a session-only closure, is cleared from the form on close,
and is released on disposal. Styling is a package contribution in
`packages/git/styles/collaboration.css`. There are no imports of Studio globals,
changes to Git repository state, or replacements of the editor's existing callbacks.

`showCollaborationSetup` accepts an `AbortSignal` as `options.signal`; its optional
grant callback receives `(url, { signal })`. Cancel/Escape immediately removes the
dialog and clears the password, aborts pending grants, and resolves `null` after any
already-created session has finished disposal. Concurrent `dispose()` calls await
the same pending journal transaction. The optional `createCollaboration` factory is
an injection seam for host composition and orchestration tests, not a network or
storage substitute in browser qualification.

### Concrete Studio integration

`GitCollaboration` in `apps/studio/git-collaboration.js` composes the dialog with the
existing Git preference/grant service. `createStudioEditorCollaborationHost` in
`git-collab-editor-host.js` captures the current workspace identity and document URI,
then subscribes to `services.documents`. Remote updates use Studio's existing
`applyStudioTextEdits` transaction; the editor's `onChange` and `onCursor` callbacks
remain intact. Switching the workspace, removing the document, reusing its editor
for another URI, closing the editor, or enabling a classic editor mode invalidates
the binding with an explicit diagnostic. Disconnection aborts any open setup and
awaits persistence before releasing the binding. The current collaboration blocks
Git operations that would replace the bound worktree through the workbench guard.

The shared workspace field initially uses the active, mounted Git repository's
stable local `repositoryId`. Without an active repository it uses a secure random
UUID; project display names never identify collaboration workspaces. The value
remains editable so another person can enter the exact shared ID. Different local
clones can have different repository IDs and therefore must explicitly select the
same shared workspace when joining.

For a mounted repository or native filesystem root, the bounded
`sharpforge.collaboration.rooms.v1` metadata record keeps at most 32 last-used room
defaults, keyed by that stable local workspace and exact document URI. Its whitelist
contains only workspace/room/document IDs, the exact WSS endpoint, display profile,
transport choice and offline preference. It never stores tokens, source contents or
actor IDs. Reopening that local document offers its previous room in explicit join
mode, and the actor lease restores the pending IndexedDB journal. Separate local
documents cannot accidentally reuse one another's saved room. A generic preview has
no durable local workspace identifier: it gets a new UUID by default, does not save
room defaults by name, and requires the user to enter the existing shared workspace
ID to resume that room after reopening. Native roots use a saved random shared ID.

Remote cursor decorations use the standard editor's source snapshot, native canvas
font measurement, CSS pixel tab stops, UTF-16 offsets and CRLF-aware line ends.
Backward selections retain anchor/focus direction. Redraws coalesce on animation
frames, show only visible lines, and are bounded to 64 peers/2,048 decorations.
Disposal removes the observer, scroll subscription, pending frame and overlay.

## Default resource limits

| Resource | Default |
| --- | ---: |
| Atoms / tombstones | 1,000,000 each |
| History operations | 250,000 |
| Pending causal atoms | 100,000 |
| Inserted plus deleted UTF-16 units per operation | 65,536, also subject to encoded byte bound |
| Encoded update | 2 MiB |
| Encoded snapshot / retained history | 64 MiB each |
| Session pending edits / in-flight updates | 10,000 / 32 |
| Server clients per room / rooms / total connections | 64 / 1,024 / 1,024 |
| Server inbound messages per connection | 64 |
| RTC direct peers / partial transfers | 32 / 8 |
| RTC fragment / aggregate partial-transfer bytes | 16 KiB / twice the update byte limit |
| Presence expiry | 45 s |

Large source snapshots and bulk edits still allocate per-atom history. Synchronous
single-update work is bounded by the limits above; hosts should apply large import
or paste operations through their existing worker/bulk-edit scheduling seam. Initial
snapshot union yields every 256 operations by default and supports an AbortSignal.
The benchmark records cold/warm latency, retained heap and a separate allocation
sampling pass; it does not claim allocation-free editing or an unmeasured browser
latency budget.

## Validation and performance commands

Run validation after the complete collaboration scope is implemented:

```sh
node scripts/limited.js node --test tests/a25-collab-*.test.js
node scripts/limited.js node --expose-gc packages/git/bench/collaboration.mjs 20
node scripts/limited.js python tests/a25_collab_browser.py
```

The Node suite includes actual loopback WebSocket framing/server restart plus
deterministic protocol, out-of-order CRDT, quota, origin, ownership, timeout,
cancellation and disposal tests. The separate browser script starts a real Node
authority, serves source ESM over loopback HTTP with an explicit CSP, and creates
independent browser contexts with the actual Studio `CodeEditor`, document events
and edit transaction adapter. It exercises native typing, preserved callbacks,
backward remote selections, direct data-channel traffic, mutual cursor visibility,
durable pending edits after reload, actual disconnected socket recovery, setup
cancellation, wrong-room denial and workspace isolation. This fixture qualifies the
real editor adapter; the complete Studio shell has its own integration gate.
Browser HTTP remains available while the
collaboration socket listener is deliberately stopped, so this gate qualifies
collaboration-offline reload and IndexedDB, not a whole-site offline HTTP cache.

Use the repository's hashed `tests/requirements.txt` and pinned Playwright browser
installation. `SHARPFORGE_BROWSER_ENGINE=chromium|firefox|webkit` selects the native
engine; an explicit `CHROMIUM_EXECUTABLE`/corresponding engine override must point
to an installed binary. Results include exact Node, Playwright and browser versions,
native backend names, engine metrics, a presence screenshot and retained failure
traces in the standard browser artifact directory. Run `npm run check`,
`npm run check:structure` and the owning complete-scope integration gate before
publishing. Report exact commits and commands with results. Do not describe an
unrun engine or a fixture socket as native qualification.

The benchmark reports correctness-gated cold creation, warm single-unit edit plus
anchor latency, snapshot merge latency, median/p95/p99, encoded bytes, machine/runtime
metadata and net retained `heapUsed` deltas. Retained heap is explicitly not total
allocation traffic. After all latency samples finish, the benchmark dynamically
loads the native [Node inspector](https://nodejs.org/docs/latest-v22.x/api/inspector.html)
and repeats the same creation, edit/anchor, snapshot/encoding and disposal workload
under [V8 allocation sampling](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json).
The latency samples never run with this profiler enabled.

The allocation report records its 32 KiB average Poisson sampling interval and
explicit inclusion of allocations later collected by both major and minor GC.
It sends only those supported parameters. In the source-verified
[Node v24.19.0 backend](https://github.com/nodejs/node/blob/v24.19.0/deps/v8/src/inspector/v8-heap-profiler-agent-impl.cc),
the effective stack depth is fixed at 128; `stackDepth` is not an accepted protocol
parameter. The backend also enables `kSamplingForceGC`, so retrieving the profile
at `stopSampling` forces a collection before extraction. The harness itself requests
one collection before sampling and none during it; those manual counts are separate
from this backend-forced collection. The report binds these verified behaviors to
Node v24.19.0 / V8 13.6.233.17-node.51, retains the exact source URLs and Git blob IDs,
and records unknown depth/implicit-GC behavior for other runtime versions.

These are estimates of allocation traffic, not exact totals or an exact
object count. Whole-isolate totals include reference-string checks, inspector and
scheduling overhead; the separate collaboration subtotal follows recorded source
stacks and may miss attribution beyond the backend's stack depth. Native/external
allocations and ArrayBuffer backing stores are outside this V8-heap measurement.

The complete native `samplingProfile` remains in the JSON, alongside its SHA-256
identity, Node/V8 versions, settings, source-attribution rule and correctness checks.
The benchmark fails with `ok: false` if profiling fails or observes no collaboration
allocations; it retains the completed latency summaries in that failure report.
This is a new service with no previous CRDT runtime baseline;
performance comparisons must use recorded commits rather than invented speedups.
