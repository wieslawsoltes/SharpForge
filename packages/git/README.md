# @sharpforge/git

Provider-neutral Git repositories, storage, transport, authentication, source-control views, and document collaboration for SharpForge.

The package uses ordinary ES modules and existing SharpForge packages. Repository operations do not require a hosting provider. Browser applications run operations in a dedicated worker and keep credentials in an explicitly scoped session. Node applications use the separate `@sharpforge/git/node` adapter.

## Repository service

```js
import { createGitService } from '@sharpforge/git';

const git = createGitService();
await git.request('init', { repositoryId: 'example', defaultBranch: 'main' });
await git.request('writeFile', { repositoryId: 'example', path: 'hello.txt', data: new TextEncoder().encode('Hello\n') });
await git.request('add', { repositoryId: 'example', path: 'hello.txt' });
await git.request('commit', {
  repositoryId: 'example',
  message: 'Add greeting',
  author: { name: 'Example', email: 'example@example.test', timestamp: 1700000000, timezone: '+0000' }
});
const history = await git.request('log', { repositoryId: 'example' });
await git.dispose();
```

An explicit `repositoryId` scopes each request. `AbortSignal` and progress callbacks are request options. Closing one repository or worker session does not close other sessions. Staging preserves the indexed snapshot even when the worktree changes before commit.

`GitWorkerClient.dispose()` immediately rejects new work and cancels pending client
promises. Cancellation messages travel asynchronously. Once the worker receives
disposal, it aborts session requests, prevents pending service initialization from
dispatching operations, and awaits service cleanup before acknowledging. A local
`Cancelled` rejection does not establish remote receipt; a fulfilled disposal
promise confirms cleanup has completed.

`GitService.register({name, run, mutates, global})` adds operations through a deliberate dispatch seam. Repository operations are serialized per repository; independent repositories can progress concurrently. A global operation is appropriate for scoped authentication setup before opening a repository. It receives no repository object.

Repository handlers receive `(repository, params, context)`. The context includes
`repositoryId`, `repositoryRevision`, `signal` and `onProgress`. `repositoryRevision`
is the mutation counter observed when the queued operation begins. Git revision
selectors belong to `params.revision`; merging the context into operation options
preserves an explicit selector and the operation's normal default when omitted.

## Storage and object formats

SHA-1 repositories use SHA1DC collision detection. SHA-256 repositories preserve their object format throughout objects, refs, index files and protocol negotiation. The package rejects mismatched object formats; it does not relabel SHA-1 identifiers as SHA-256 identifiers.

Memory, IndexedDB, OPFS and selected filesystem directories implement the same object-store contract. The native adapter reads and writes real Git directories. Storage capabilities describe the backend actually selected, including browser fallbacks. Object decompression, pack processing, paths, revision traversal and message queues have explicit resource bounds.

## Studio integration

The **Git** menu exposes Changes, Repository, Diff, Merge Conflicts, provider Issues/Pull Requests, Settings, Remote Snapshot, Repository Tools, and Live Collaboration. The shell registers these through the existing command, menu, service and tool registries. The Git engine loads only when a Git action is invoked. History and diff windows create only visible rows. Historical views use separate read-only editor models.

Repository Tools exposes verified LFS content and missing-object placeholders, explicit submodule trust, sparse checkout, integrity checks, storage usage, maintenance, and ZIP/bundle exchange. The active source editor can show a virtual blame margin. Provider review annotations compose with language diagnostics through the owned annotation registry; bulk source replacement uses the same document event seam as normal editor changes.

Commit identities, proxy origins and network grants are editable independently of credentials. A runtime origin grant cannot relax the web server's Content Security Policy: the deployment must also permit the selected origin. Repository-provided hooks, filters, aliases and scripts are never executed.

## Hosting and collaboration

Smart HTTP Git transport and provider hosting APIs have separate contracts. Provider capability records state which operations preserve canonical Git object bytes and which operations supply atomic compare-and-swap. Unsupported guarantees produce explicit diagnostics. A metadata snapshot is not presented as a canonical clone.

Live collaboration uses independent room/document identities, authenticated transports, durable pending updates and a sequence CRDT. Collaboration state is not stored as Git commits. A Git operation cannot implicitly join a collaboration room.

## Detailed contracts and qualification

- [Objects, SHA1DC and compression](docs/objects.md)
- [Storage, references and configuration](docs/storage.md)
- [Local workflows](docs/workflows.md)
- [Protocols and remote operations](docs/protocol.md)
- [Authentication and provider APIs](docs/auth.md)
- [Repository service adjuncts](docs/service-adjuncts.md)
- [Collaboration](docs/collaboration.md)
- [Differential conformance](docs/conformance.md)
- [Complete project scope and qualification obligations](docs/qualification-scope.md)

The package tests distinguish native Git interoperability, actual browser storage/worker execution, provider contract fixtures, and live provider access. An unavailable platform or provider credential is reported explicitly. See retained delivery evidence for the commands and revisions actually qualified; the existence of a module alone is not a passing capability claim.
