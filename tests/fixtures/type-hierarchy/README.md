# Cross-assembly browser hierarchy

Implementation-ready #2574, stacked on the shared symbols SHA-1 extraction #4488.
No install, test, benchmark, browser or native build has run for this batch. Root
coordinates one serial qualification slot. Source fixture `input.mjs` is authored
CLI metadata, including intentionally baseless classes; it is not claimed to be
Roslyn-generated or executable. It exercises actual AssemblyRef/TypeRef binding
across two loaded images and nested scopes, rather than substituting a local graph.

The nine prepared test groups cover base/derived/implementer sets; missing and
ambiguous assemblies/types; declared version/culture/full-key/token identities;
nested versus same-display-name lookalikes; explicit TypeSpec/ModuleRef/nil-scope
results; local/cross-module inheritance and TypeRef cycles; wrong interface kinds;
malformed heap/coded references; exact/minus-one budgets; cancellation and owned
returns after input metadata is destroyed. Known interface diamonds are expanded
once and repeated nodes retain their stable ID without further children.

The retained CoreCLR corpus `../clr-type-graphs/native-graphs.json` reports SDK
10.0.201 / .NET 10.0.5. Its embedded image SHA-256 is
`6f2ba4d03f35bb7b4be65463c2f6bc19fd9451da21a695ce3ccf8a66b504131a`.
The authored test compares captured direct bases and the full local interface-
implementer set, and expects a dead reference for the absent framework assembly.
No new native build is needed; this native evidence does not manufacture a native
oracle for the separately authored cross-image/declared-key negative fixtures.

Planned serial qualification: shared SHA-1 tests and affected PDB consumers, new
hierarchy tests plus existing local/nested name-index callers, a single fixed
before/after name-index control and opt-in graph construction/query capture,
focused Chromium/Firefox/WebKit round, then static/manifests/structure. Preserve
all raw observations and failures. Broader platforms, runtime execution and the
Studio/full matrix remain unclaimed. Counter budgets are logical input-occurrence
charges and count limits; they do not measure process heap or peak allocation.
