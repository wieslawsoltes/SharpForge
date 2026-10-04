# IL-document user-string native fixture

Three ordinary library methods retain an old numeric #US token or return a newly
added quoted literal. The Main edit inserts 300 NOPs into a loop, requiring both
forward and backward branch widening. The new literal includes quotes, URL //,
newline, non-ASCII/supplementary characters and NUL; Again shares its added token.

Prepared, not run. At the serial slot, run prepare.js through scripts/limited.js,
build oracle/Strings.csproj with SDK 10.0.201, `--disable-build-servers -m:1` and
isolated temporary obj/output paths, then pass the generated DLL to Strings.dll.
Capture the actual runtime version/results as native.json. No native result is
claimed before that capture; standalone ilasm and Portable PDB editing are separate.
