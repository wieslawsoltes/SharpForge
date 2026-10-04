# Edited IL-document native reference

Four ordinary managed methods are exported to SharpForge IL text, edited with 300
new NOP instructions, and assembled with explicit branch layout. Native execution
covers a widening branch, catch leave/EH endpoints, filter offsets, and switch targets.
The fixture uses the existing metadata-preserving document/PE seam.

Captured with SDK 10.0.201 / .NET 10.0.5 on macOS ARM64. All four results match
native.json; the oracle build has zero warnings/errors. Inserted padding is outside
the handler end boundary, so the handler exits through leave without a fall-through
tail. Run prepare.js through
scripts/limited.js, build oracle/Layout.csproj with SDK 10.0.201 using
`--disable-build-servers -m:1` and temporary obj/output paths, then run Layout.dll
with the emitted DLL path. The direct CIL VM supports the branch/catch/switch cases;
filter execution is native-only in this increment.
