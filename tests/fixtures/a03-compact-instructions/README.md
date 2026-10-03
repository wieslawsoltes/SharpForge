# Compact CIL helper reference

The prepared fixture emits equivalent wide and compact CIL bodies using public
CilWriter APIs and the existing managed-fixture builder. It covers integer bit
patterns, a byte-index argument, and a 16-bit local index. The native oracle invokes
every method under .NET and records actual results. Capture is pending.

Run prepare.js through scripts/limited.js with a temporary output directory, build
oracle/Compact.csproj with `--disable-build-servers -m:1` and isolated temporary
obj/output directories, then pass the fixture directory to Compact.dll. Native
results are pinned in native.json after validation; no platform matrix is claimed.
