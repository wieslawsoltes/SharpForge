# Native package and RID acceptance corpus

The package workflow uses three locally SDK-packed packages and cleared external feeds. It compares effective NuGet source hierarchy
with the selected SDK, proves credentials are omitted from returned models, preserves comments/quotes/CRLF during add/update/remove,
compares direct/transitive assets with native package listing, inspects actual nupkg compile/runtime assets, preserves lockfile bytes,
requires native NU1004 for lock drift, and checks central package edits against the portable evaluator.

Independent offline C# probes load NuGet assemblies shipped in the selected SDK: 29 version parsing vectors, 11 comparisons and
22 range/floating expressions against 11 candidates; all 85 portable RID expansions against NuGet.RuntimeModel. The shared helper
compiles directly against the installed reference pack and SDK assemblies with no package restore or network dependency. Exact NuGet,
SDK, runtime, Node, platform and graph source information appears in the test diagnostics.

Pure cases retain source mapping specificity, hidden credentials, SemVer edge cases, restore diagnostics, lock/central rules, V3 cache
and byte budgets, unknown/invalid RID diagnostics, copied immutable graph data, a 20,000-node iterative traversal boundary, process trust,
environment filtering, cancellation and project/SDK/publish diagnostic contracts. HTTP protocol tests use recorded local responses;
those responses are not presented as live public NuGet availability.

This corpus passed during the completed Linux/x64 native scope with Node 22.23.3 and Node 26.10.0, SDK 10.0.201, runtime 10.0.12 and
NuGet assembly version 7.3.0.0. Original logs and exact commands are retained by planning/evidence/project18/native.json. Native/public
NuGet v2/v3 endpoint access was separately blocked during proxy CONNECT before TLS, so ten popular public-package vectors and live
advisory qualification remain unavailable. No repeated restore or full matrix is performed for publication.

Run scheduled native cases through scripts/limited.js with SHARPFORGE_DOTNET and SHARPFORGE_NATIVE_SDK. Unset native tool options
produce explicit skips. No Windows/macOS/arm64 or unavailable SDK pass is implied by the JavaScript and Linux results.
