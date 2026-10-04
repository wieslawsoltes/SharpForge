# Native host service transport

`startMSBuildHost({root, nativeServices: {contributions}})` composes the installed SDK service contribution and any explicitly supplied
contributions. Each receives `(registry, {engine, workspace})`; register a scope/operation handler and add owned closable services to
`registry.disposables`. `createNativeServices` is exported from `@sharpforge/msbuild/node` for explicit host composition.

`MSBuildClient.service(scope, operation, request, {signal})` invokes the authenticated JSON route. Scope and operation names contain only
lowercase letters and hyphens. An absent contribution returns 404. Structured error codes, paths, bounded located diagnostics and existing
mutation receipts survive the client boundary. The SDK client conveniences are `sdkInventory`, `resolveSdk` and `workloads`.

The server continues to require its exact loopback Host, same-origin request metadata and in-memory bearer token. Mutation bodies require
application/json and are bounded to34MiB. Builds remain explicitly trusted native code. Request cancellation passes to service handlers;
closing the host disposes registered services before closing the engine and HTTP listener.

Raw `/binary` reads support regular files admitted by the workspace path and artifact-byte budgets. Reserved paths and symlink components
remain rejected. Native filesystem operations, design-time contexts, package operations and binlog readers register in subsequent feature
batches; their missing registration is an explicit404, with no invented capabilities or fallback data.

The server delegates routing to small modules and its existing legacy entry shrinks. The public client entry re-exports the same class;
credentials are never persisted, included in a query string or forwarded through redirects. Existing build/job/file routes and statuses remain
compatible. This extraction changes composition only; it does not start a watcher, SDK install or package restore.
