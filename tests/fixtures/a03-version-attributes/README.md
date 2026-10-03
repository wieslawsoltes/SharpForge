# Metadata version attribute projection

Prepared for serial validation. Compile `Versioned.cs` with SDK 10.0.201 Roslyn
(`-noconfig -nostdlib -target:library`, reference-pack System.Runtime.dll). Then run
`capture.js OUTPUT_DIRECTORY ROSLYN_ASSEMBLY LLVM_READOBJ` through the Node limiter.
The fixture pins actual Roslyn PE bytes and LLVM's independent version resource payload
from the projected output. It does not execute attributes or claim Windows Explorer behavior.

The targeted test compares known source attribute values, the full emitted payload and
numeric VS_FIXEDFILEINFO version fields. Native capture and focused tests are pending.
