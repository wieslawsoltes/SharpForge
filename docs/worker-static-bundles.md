# Static worker module bundles

`scripts/bundle-worker.js` keeps the public `bundleWorker(entry)` build entry point.
The graph traversal and module syntax handling live in small adjacent build modules so
the legacy entry file shrinks. This bundler handles the repository's static ESM subset;
it does not add a general runtime module loader or a JavaScript evaluation service.

Supported dependency forms are relative named imports, `import * as namespace`, named
re-exports, and `export * from`. Complete import/export declarations begin a line and
end with a semicolon where required. Local named export lists and exported class,
function, const, let, and var declarations retain their existing role. Default imports,
namespace re-export syntax, unresolved package specifiers, and cyclic module graphs fail
with an explicit build error. Package specifiers must first pass through the build's
existing package-to-relative-path rewrite.

Every module executes once in dependency order. Repeated namespace imports share one
null-prototype, frozen export view. Its getter properties expose updated exported locals,
while assignments to namespace properties fail in the strict generated bundle. Named
imports keep the existing static destructuring behavior; code that requires subsequent
reads of changing exported locals uses namespace access. Export aliases preserve their
binding identity through wildcard paths. Conflicting wildcard names remain ambiguous
unless an explicit export selects one, matching namespace enumeration expectations.

Source edits are applied once from their original positions rather than repeatedly
replacing a growing module string. Function bodies, including the pinned HarfBuzz factory,
remain ordinary source text. The bundler never instantiates Wasm or executes those factories
while bundling. The application still owns its explicit Wasm bytes and initialization.

`tests/a17-worker-namespace.test.js` authors coverage for namespace identity, read-only
properties, live namespace reads, evaluation order, aliases, wildcard ambiguity, unsupported
syntax, unresolved imports, cycles, and the actual vendored named factories. It executes
generated files as ordinary Node programs when the consolidated validation gate runs;
it does not use `eval` or a dynamic-code constructor. No execution result is implied by
adding those tests.
