# NuGet package archive inspection

The browser-safe entry exports `readNuGetPackage(bytes, options)` and
`selectPackageAssets(packageData, targetFramework, options)`. They reuse the
public archive, XML, TFM compatibility and runtime fallback contracts.

`readNuGetPackage` reads a bounded ZIP and requires a root nuspec with package
metadata. It returns scalar metadata, dependency groups and archive file records.
Options are passed to the archive reader, including its size/count/expansion
limits and content policy. Invalid ZIP structures, unsafe entry names, corrupt
compressed data, missing nuspecs and malformed metadata produce errors.

`selectPackageAssets` chooses the nearest compatible `ref` group for compilation,
falling back to `lib` only when no compatible reference group exists. Runtime
assemblies and native assets independently follow the selected RID fallback
graph. `_._` placeholders suppress empty groups and are omitted from results.
Analyzer paths, build props/targets and content files remain visible as distinct
asset lists. Unknown runtime identifiers return explicit diagnostics.

The default reducer is the public project-system `nearestTargetFramework`.
Callers may supply `nearestFramework` and an explicit `runtimeGraph` to use the
same resolution profile as their project context. The result describes assets;
it does not install packages, execute analyzers/build scripts or run arbitrary
native files from the archive.

The focused test uses an in-memory package to distinguish ref compile inputs,
RID runtime assemblies and native files, and verifies invalid archive rejection.
Qualification against unavailable external feeds is tracked separately from
these offline archive and resolution contracts.
