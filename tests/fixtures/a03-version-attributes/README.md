# Metadata version attribute projection

Captured on macOS ARM64 with SDK 10.0.201, Roslyn 5.3.0-2.26153.122 and LLVM 22.1.8. Compile `Versioned.cs` with SDK 10.0.201 Roslyn
(`-noconfig -nostdlib -target:library`, reference-pack System.Runtime.dll). Then run
`capture.js OUTPUT_DIRECTORY ROSLYN_ASSEMBLY LLVM_READOBJ` through the Node limiter.
The fixture pins actual Roslyn PE bytes and LLVM's independent version resource payload
from the projected output. It does not execute attributes or claim Windows Explorer behavior.

The targeted test compares known source attribute values, the full emitted payload and
numeric VS_FIXEDFILEINFO version fields. Native capture matches all six source values and the emitted fixed file version. All 15
projection/Win32 tests pass; broader Windows/browser qualification remains open.
