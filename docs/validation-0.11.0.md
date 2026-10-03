# SharpForge 0.11.0 — observed validation

## Release scope

Starting point: the supplied SharpForge 0.10.0 source ZIP (1,669 Node tests, 20 packages). Implementation and validation performed on October 2, 2026. Node v22.16.0, Linux x64, Python with Playwright, Chromium 144.0.7559.96. No remote publication or hosted CI run was performed.

| Gate | Result |
|---|---:|
| Node regression suite | **1,809 passed**, 0 failed, 0 skipped; **140 added** |
| JavaScript syntax | **177 modules**, 0 errors |
| Browser acceptance | **276 checks** across 11 suites |
| New project/item/ZIP browser suite | **23 checks** |
| Actual local-host native explorer suite | **13 checks** (2 added) |
| Standalone HTML | **43 checks**, 2 real workers |
| Independently installed tarballs | **22/22 passed**, offline |
| Microsoft SDK execution | **Unavailable**, separate gate exits 1 with `dotnet` ENOENT |

## Template and archive verification

Every project/solution template is validated against real emitted XML and compiler results. Executable cases run in the source VM, canonical CIL reload, direct-CIL VM and exported/reassembled IL. Library templates are compiled as libraries with no Main; separate host source exercises their APIs in those paths. This is not separate native assembly-linker qualification. All 19 item templates compile after actual project membership edits. The packaged template folders and adjacent ZIPs are compared against the public catalog; the nineteen-item gallery compiles as a library.

Python's independent standard ZIP reader verifies SharpForge export CRCs, Unicode names, binaries and empty folders. Python-generated DEFLATE ZIPs with and without data descriptors are imported. Negative tests cover traversal, reserved paths, duplicates, case/Unicode aliases including parent directories, malformed CRC/headers/descriptors, overlap, encryption, links, ZIP64, count and expansion limits. UTF-8/UTF-16 BOMs, CRLF and binary/invalid-text `.cs` assets survive repeated exports. Manifest tests verify entry/startup/settings validation and that execution trust, host URLs and arbitrary extension code do not round-trip.

File System Access **test doubles** exercise empty-folder preflight, denied permission, cancellation, mid-write failure reports, source conflict checks before and after permission resolution, and encoding preservation. They do not constitute native browser file-picker/permission-dialog qualification.

Separate Node tests use real temporary directories and the native file engine for byte-exact binary creation/undo, unrecognized-file scanning and case-alias rejection before mutations. CLI subprocess tests create a real app/library solution, ZIP it, extract it into an empty directory, preserve settings/assets/empty folders and execute the extracted project to `42`. Duplicate or traversing output plans do not create a destination directory.

## Browser coverage and limitations

Production Studio/compiler/runtime modules and actual worker bundles run in Chromium, not a mocked compiler. The new suite creates an app plus library, runs it to `42`, adds partial classes, rejects collisions, adds another project, exports/restores startup and breakpoint settings, imports an external project's sibling dependencies/binary assets, opens asset-only and empty-solution workspaces, selects among multiple projects, navigates generated WinUI Home/Settings pages, adds page/UserControl templates, and executes a generated counter's managed event. Existing editor modes, docking/popouts, debugger breakpoints, reverse execution, source symbols, task stacks, function evaluation and compatible Hot Reload remain covered by the other suites.

The native explorer browser suite uses the **production native client and real loopback HTTP/local filesystem host**, bridged by a byte forwarder solely because normal navigation is blocked. New checks use the project wizard to create actual disk project/SLNX files and add a binary asset byte-for-byte. The MSBuild operation suite is separately labeled as a simulator/client-double test; neither is counted as real Microsoft SDK compilation.

Normal HTTP navigation was explicitly retried and returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Browser acceptance therefore uses the documented in-memory origin harness; standalone is injected into about:blank. Browser storage uses a harness shim where required. Actual HTTP/file-origin navigation, native permission dialogs, durable browser storage, physical WebGPU, native SDK builds and external native IDE/CLR interoperability are **not qualified**. WinUI event/layout tests exercise the existing supported web host, not native Windows App SDK behavior.

One existing DAP test assumed a single wall-clock scheduling slice completed Main. Under simultaneous test/browser load that assumption failed. It now pumps to a real managed scheduling boundary with a finite limit, retaining its scene/event assertions. The final complete suite has zero failures; earlier intermediate failures were fixed, not omitted.

## Reproduce

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run test:packages
npm run standalone
SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:templates
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone
npm run examples:templates
node apps/cli/main.js run examples/templates/console-library-solution/ConsoleLibrarySolutionExample.slnx
```

Native SDK gate: `npm run test:msbuild:native`. An unavailable SDK is an explicit failure/unavailable result, never a simulated pass.

## Delivered archive verification

A file-length/SHA-256 manifest is included as `docs/source-manifest-0.11.0.json`. Verification of the **exact packaged source ZIP** is performed after packaging in a separate clean directory: manifest check, offline install, tests, syntax, rebuild, CLI round-trip, isolated packages and selected browser/standalone workflows. Its measured results, archive SHA-256, and standalone/tarball byte comparisons are supplied alongside the release as `SharpForge-0.11.0-final-archive-verification.txt`; that post-packaging record is deliberately not embedded in the ZIP it hashes.
