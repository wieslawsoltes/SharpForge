# Compact CIL helper reference

The prepared fixture emits equivalent wide and compact CIL bodies using public
CilWriter APIs and the existing managed-fixture builder. It covers integer bit
patterns, a byte-index argument, and a 16-bit local index. The native oracle invokes
every method under .NET and records actual results. All 28 invocations match on
.NET 10.0.5, captured using SDK 10.0.201 on macOS ARM64.

Run prepare.js through scripts/limited.js with a temporary output directory, build
oracle/Compact.csproj with `--disable-build-servers -m:1` and isolated temporary
obj/output directories, then pass the fixture directory to Compact.dll. Native
results are pinned in native.json; no platform matrix is claimed.
