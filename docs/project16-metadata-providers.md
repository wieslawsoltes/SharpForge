# Object Browser and Code Definition metadata providers

Work items: SF-A19-T17 (#1453) and SF-A19-T23 (#1459).

The registered framework model also includes core intrinsic declarations from the actual bytecode builtin catalog. Canonical owners, instance receiver rules and parameter categories come from the same public bytecode metadata helpers used by compiler binding. This covers `System.Console.WriteLine`, primitive/string members and other core intrinsics that are not entries in the separate framework contribution table. Accepted core arities are shown as signatures; internal `$` builtins are excluded. This model identifies itself as registered SharpForge metadata, separately from inspected PE metadata.

The shell owns one `MetadataCatalog`. Object Browser and Code Definition share
its declaration models, while each tool owns its cancellation and selection
state. The framework model is built from the public registered contract tables.
External references use the public `@sharpforge/cil` `AssemblyInspector` in a
dedicated worker. Inspection reads CLI tables and signatures; it does not decode
method instructions, load an assembly into the runtime, or execute any code.

## Workspace integration

The default source provider enumerates `ProjectSystem.projects[*].references`
and resolves `HintPath` against `ProjectSystem.files`. A reference without a hint
can match one authorized DLL by its simple name; multiple matches are an error.
Project-reference reachability makes a referenced project's metadata visible to
its consumers. Missing bytes produce an explicit row explaining that the user
must open or add the reference. No directory/network access is initiated.

`readAssemblyReference(descriptor, {signal})` is an optional host callback for
authorized native or handle-backed references. It returns `Uint8Array`. Existing
`assemblies()` summary providers remain accepted. `metadataSources()` and
`createMetadataWorker()` remain injectable seams. The standalone build must
register `workbench/metadata/metadata.worker.js` as a worker entry.

Record enumeration reads names, versions and binary metadata; it never reads a
source document's `text` getter. Binary inputs remain with their original record;
the catalog retains declaration models only. A cache key includes the workspace
generation, owning project, path, source version and record identity. The model
also retains actual Assembly identity and Module MVID from the PE.

## Display and definitions

Object Browser groups declarations by assembly and namespace, exposes types,
methods, constructors, fields, properties and events, and uses actual signature
and owner text for search and summaries. Generic parameter names replace VAR and
MVAR positions. A signature that cannot be decoded remains an explicit diagnostic.
Selecting a member exposes its signature and assembly identity; opening it uses
the host inspection callback or the read-only metadata source preview.

Code Definition first asks the language service for a source definition. It then
uses structured bound hover metadata, or a bounded qualified identifier such as
`Console.WriteLine`, to resolve the actual owner/member. It does not parse hover
prose. An ambiguous type across assemblies requires an explicit assembly or fully
qualified name. When parameter types identify a matching overload, that overload
is selected; otherwise the preview states the number of matching overloads.

The read-only source URI includes project, assembly identity, MVID, input version
and metadata token. Its result also carries the source document's captured version.
The view compares document identity, source version, project, workspace generation
and caret before showing an asynchronous result. Setting the preview selection
does not focus the preview.

## Bounds and qualification

At most 512 reference descriptors can be enumerated; one view can inspect up to
32 references. Each PE is at most 32 MiB, with at most 50,000 declarations and 8 MiB
of signature text. The catalog retains at most 100,000 declarations. A metadata
source preview is bounded to 1 MiB and the displayed excerpt to 64 Ki UTF-16 units.
Worker operations are serialized and stop on cancellation, disposal or a 15-second
timeout. Building large UI/source data yields periodically.

The focused tests use the checked-in real C# compiler output in
`tests/fixtures/metadata`, whose provenance records .NET SDK 10.0.201. They cover
generic `List<T>` members, overloaded methods, strong identities, different
versions of the same assembly, source cache invalidation, project reachability,
bad/unavailable references, bounds, worker cancellation and a large document whose
whole-text getter throws. They do not execute those assemblies. The browser's
300 ms follow-caret threshold remains an actual browser qualification, separate
from provider correctness.

The first complete provider scope at `364023a3` exposed two core-intrinsic definition failures. The shared builtin metadata seam and intrinsic projection fixed both. An affected run also caught duplicate core/framework signature presentation; canonical signature deduplication fixed it. The final metadata file passed all 12 cases at `3b3f6546`; both shared-builtin seam cases passed in the preceding affected run. Exact commands, failed attempts and corrected results are preserved in `docs/project16-shell-provider-evidence.json`.

Final source review changed the intrinsic projection to iterate the public `BuiltinMap` name index instead of walking holes in the sparse stable-ID dispatch array. It visits actual descriptors and retains compiler lookup semantics. This equivalent enumeration improvement is included in root's integrated gate; it does not alter runtime instructions or contract IDs. The shell lane has not claimed a new whole-suite run for this source-only correction.
