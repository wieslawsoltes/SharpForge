# Edited IL-document native reference

Four ordinary managed methods are exported to SharpForge IL text, edited with 300
new NOP instructions, and assembled with explicit branch layout. Native execution
covers a widening branch, catch leave/EH endpoints, filter offsets, and switch targets.
The fixture uses the existing metadata-preserving document/PE seam.

Capture is pending the serial validation slot. Run prepare.js through
scripts/limited.js, build oracle/Layout.csproj with SDK 10.0.201 using
`--disable-build-servers -m:1` and temporary obj/output paths, then run Layout.dll
with the emitted DLL path. The direct CIL VM supports the branch/catch/switch cases;
filter execution is native-only in this increment.
