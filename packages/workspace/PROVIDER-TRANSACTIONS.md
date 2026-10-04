# Physical provider transaction adapter

`ProviderTransactionAdapter({getWorkspace, ready, maxBytes})` composes the public workspace journal with
an attached provider-backed directory. `ready` must resolve the stable physical identity/save-lock
service. Every transaction holds one exclusive workspace Web Lock. In-memory workspaces without
attached handles use the journal's atomic model path.

The adapter materializes only affected lazy files under metadata and byte limits. It preflights all
encoded writes, destinations, deletes, directories, permissions and expected physical hashes before
the first effect. Permission prompts and directory scans are followed by another complete hash check.
Untracked hidden entries prevent directory removal. Document version exhaustion also fails admission
before writing any member of the batch.

Each completed physical primitive is reported to the journal and persisted through its receipt store.
A later I/O failure leaves the application model unchanged and enumerates exactly which physical
mutations completed; it does not claim whole-directory filesystem atomicity. The composition host
provides durable receipts and explicit recovery decisions.

Finalization adopts exact persisted bytes through ProviderDiskWorkspace.adoptRecords, rebuilds disk
indexes, advances only committed hashes and retains monotonic document version watermarks. Unrelated
unsaved editor overlays are never substituted for physical baseline records. The dependent Explorer
history callback supplies diskCommitted/persistedPaths and dirty-path metadata to its session commit.

The seven focused cases use the actual ProviderDiskWorkspace and FileSystemAccessProvider with a
deterministic in-memory directory-handle fixture. They cover rename/undo/redo, collision and hash
preflight, partial close failure receipts, affected lazy binary files, hidden entries/disposal,
watermark survival through unload/reopen, and version exhaustion. Actual picker/browser/OS behavior is
qualified separately; the fixture is not a platform pass.
