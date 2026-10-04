# Static standalone module and worker graphs

The browser build retains native ESM for the application and bundles contributed
workers. The single-file release uses the same `bundleWorker` graph compiler for
the application and every literal worker URL, including editor and workspace
search. Deferred module declarations are ordinary function bodies in the one
hashed entry script. Their static dependencies initialize at first activation;
dynamic import expressions become microtask-deferred calls into a memoized
factory. A module runs once and repeated failed evaluation returns the same error.
The complete standalone source bytes are present in the HTML; first use defers
evaluation rather than claiming a deferred network download.

There is no runtime source compilation, eval, Function constructor, or injected
script element in the generated loader. The existing production policy supplies
the exact entry-script hash and trusted Blob worker permission. Its network
origins remain explicit configuration. Worker Blob URLs are allocated on demand,
deduplicated within their owning context, retained across page-cache suspension,
and revoked on final page disposal. Nested workers receive their own embedded
dependency graph rather than relying on variables in the parent page.

The bundler intentionally supports the repository's immutable named declarations,
named and namespace imports, side-effect imports, and named/star re-exports. It
checks named exports and static cycles. Default or mutable declarations requiring
full native ESM semantics fail explicitly. Dynamic paths must be unescaped
relative string literals. Computed imports, import options, arbitrary import.meta,
unresolved packages, external URLs, and real paths outside the configured asset
root fail at build time. Comment, string, and regular-expression text is not
rewritten; executable template expressions are inspected.

The existing ComputePool source supports both Node and browser workers. The fixed
`node:worker_threads` adapter is compiled to an explicit rejected promise in browser
artifacts, because Node is not a capability of that artifact. Original Node source
behavior remains available. Numerical browser workers still execute their actual
trusted kernel program.

`tests/a19-static-bundle.test.js` exercises deferred initialization order, identity,
failure caching, lexical boundaries, graph rejection, CSP hash enforcement,
worker dependency execution in isolated VM contexts, nested workers, and URL
lifetimes. VM fixtures verify generated JavaScript behavior; they do not qualify
browser worker security, file-URL storage, browser paint, or native hosts. Actual
offline navigation and Studio activation remain covered by browser fixtures and
require a browser-equipped runner.

## Recorded validation

The complete normal distribution and standalone builds passed after integrating
the Project 16 module graph. The resulting standalone was 10,767,567 bytes and
contained four worker graphs. All 26 focused bundling, lazy activation, document
focus, and CSP regression tests passed using the resource-limited wrapper. The
emitted entry and every worker payload parsed successfully; the exact generated
CSP hash passed inspection. The entry has no lexical dynamic-code uses. The only
worker lexical `eval` match is the pre-existing, explicitly allowlisted managed
expression interpreter method `eval(n)` in `packages/debugger/src/evaluation.js`,
which does not call JavaScript eval. No browser execution result is claimed.
