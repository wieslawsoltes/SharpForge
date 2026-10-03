# Independent Win32 resource reader

`llvm.json` captures LLVM's PE/COFF resource reader on an emitted library containing VS_VERSIONINFO, an application
manifest and a one-image ICO group. The fixture uses explicit version options; compiler assembly-attribute projection remains outside this slice.
Only the input path is replaced by `<fixture>`; resource values and bytes are the real reader output.

Regenerate in the local validation slot, then run the focused Win32 tests:

```sh
node tests/fixtures/a03-win32-resources/capture.js /tmp/a03-win32-fixtures /path/to/llvm-readobj
node --test --test-concurrency=1 tests/a03-03-win32-resources.test.js
```

Windows Explorer display and Windows process-loader qualification are not claimed by this host-independent fixture.

Captured using Homebrew LLVM 22.1.8 on macOS ARM64. LLVM parsed all four resource types (ICON, GROUP_ICON, VERSIONINFO,
MANIFEST), their IDs/language/codepages/sizes and payload bytes. The focused test rebuilds the same resource inputs and
compares every byte against the captured independent output. All eight focused tests passed, covering both JavaScript
engines, desktop entry thunks, PDB attachment on data sections, malformed trees and Buffer copy ownership.
