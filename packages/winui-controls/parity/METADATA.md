# Pinned WinAppSDK reference metadata

`import-inventory.js` reads only the restored package versions and content hashes
in `tests/conformance/oracle/WinUI/packages.lock.json`. Package acquisition and
lock hash verification are preparation steps; the importer does not download
packages. Its output contains public API facts and source hashes, never WinMD
binaries or runtime assets.

## Target-specific metadata selection

`Microsoft.WindowsAppSDK.InteractiveExperiences` 1.8.260708001 includes distinct
`Microsoft.UI.winmd`, `Microsoft.Foundation.winmd`, and `Microsoft.Graphics.winmd`
files in two directories. They share basenames but contain different metadata.
Combining both variants is ambiguous and does not reproduce a consuming project.

The package's `build/Microsoft.InteractiveExperiences.Common.targets` sets
`Ixp-UAPTargetVersion` to `10.0.17763` when `TargetPlatformVersion` is empty or
below `10.0.18362.0`; otherwise it uses `10.0.18362`. `_IxpMetadataFolder` then
selects the corresponding `metadata/<version>.0` directory. The build-transitive
and native target files use the same selection.

The importer requires one explicit, non-RID Windows target framework from the
lock. Its current `net10.0-windows10.0.19041` target normalizes to
`10.0.19041.0`, selecting **`metadata/10.0.18362.0`**. Version comparison uses
numeric components. A target below the threshold selects `10.0.17763.0`. The
importer rejects unspecified or multiple target frameworks, a missing selected
identity, and unexpected variant layouts. It leaves all restored package bytes
in place and does not fall back to a different target's metadata.

WinUI and Foundation retain their unversioned metadata. Duplicate selected
basenames still require identical bytes. Imported provenance records the target,
selected relative file paths and hashes, and the selection rule file's SHA256.

## Preparation and deferred execution

Restore the exact locked package set or prepare equivalent verified package
directories under `NUGET_PACKAGES`. For signed NuGet archives, `contentHash` is
the normalized unsigned-content SHA512 defined by NuGet's
[SignedPackageArchiveUtility](https://source.dot.net/NuGet.Packaging/Signing/Archive/SignedPackageArchiveUtility.cs.html).
It is not the raw signed ZIP archive checksum. Retain both when preparing inputs;
content identity verification does not establish signature trust.

Use the SDK, runtime, compiler hash and reference assembly hash set pinned in
`planning/qualification/oracle-toolchain.json`. Set `SHARPFORGE_ORACLE_DOTNET`
to that `dotnet` executable and `NUGET_PACKAGES` to the verified package root.
Then, from the repository root, after the complete-scope validation gate:

```sh
node packages/winui-controls/parity/import-inventory.js
```

This command compiles the pinned read-only PEReader metadata extractor, executes
it twice to check deterministic API facts, and updates
`packages/winui-controls/parity/winappsdk-inventory.json`. Raw metadata extraction
can use the pinned Linux CoreCLR; it does not run or qualify the Windows-only
WinUI desktop oracle. Focused selection coverage is authored in
`tests/a16-metadata-selection.test.js`; execution remains part of grouped scope
validation.
