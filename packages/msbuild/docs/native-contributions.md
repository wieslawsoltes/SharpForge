# Native service contributions

`NativeServiceRegistry` is the explicit host extension point. Register a handler with `register(scope, operation, handler)` and invoke it with `invoke(scope, operation, request, { signal })`. Duplicate registrations fail; unknown operations return a 404 error. Register disposable services in `registry.disposables` so host shutdown closes them.

The public Node entry exposes `registerNativeSdkServices`, `registerNativeProjectServices`, `registerNativeNuGetServices`, `registerNativePublishServices` and `registerNativeBinlogServices`. Each accepts the registry and `{ engine, workspace }`; NuGet additionally accepts the configured host credential/feed options. SDK registration returns its cached `discover` function, and binlog registration returns its bounded reader. These functions retain the same handlers used by the default host.

`createNativeServices(engine, options)` composes those families and the native testing adapter. Optional `options.contributions` run after the built-in registrations with the same context. A contribution should use `engine.runTool` for native processes and honor the supplied abort signal. It does not replace workspace trust, process policy, root restrictions or the saving/build guard.

Family registration is separated from HTTP routing so independently reviewed SDK, context, package, profile and test adapters can share one host without editing central action switches. The complete default composition remains available through `startMSBuildHost`.

Native workspace encoding delegates to the shared archive codec through a small internal I/O module. SHA-256, file budgets, unchanged bytes, encoding/BOM retention and guarded saves keep their existing behavior. CLI help is a separate data module with the original public `MSBUILD_HELP` export.

The authenticated server delegates API routing to `api-routes.js`; Host, origin, token and static-file validation stay in the server.
VFS and binlog routes invoke registered services, so absent contributions produce the registry's explicit 404 response.
The client entry re-exports the same `MSBuildClient` API from its formatted implementation module. Request shapes, cancellation,
response codes, write guards and disposal remain unchanged. Native HTTP and workspace regressions cover this mechanical extraction.
