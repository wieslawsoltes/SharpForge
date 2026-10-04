# Native design-time project services

`MSBuildClient.projectContext(request, {signal})` invokes the registered
`project/context` service and returns `{context, cached, jobId?}`. The request uses
the native build contract: `project`, `configuration`, `platform`, `framework`,
`runtime`, `properties` and explicit `trusted: true`. The selected SDK executes
the design-time targets with `SkipCompilerExecution` and `ProvideCommandLineArgs`.
The result retains the actual compiler options, inputs, references, diagnostics,
context identity and artifacts described in [project-context.md](project-context.md).

`projectContexts(request, {signal})` discovers target frameworks and evaluates each
isolated context. `allRuntimes: true` includes declared runtime identifiers; the
matrix is limited to 128 cells. Cancellation propagates to the owning native job.

The Node entry exports `DesignTimeBuildService`, `createDesignTimeRequest`,
`DESIGN_TIME_TARGETS`, `DesignTimeCache` and `collectGeneratedSources`. The SDK
target set uses `Compile`; the explicit `cps` set selects CPS design-time targets.
Unknown target sets fail. Contexts are cached only after successful native work.
Content fingerprints, import dependencies, ancestor build configuration and
directory membership invalidate cached results when source membership changes.
The cache retains at most 128 entries by default and maintains a reverse index for
shared imports. Closing its owning service clears the cache.

Sources under the granted workspace use portable workspace paths. Generated C#
under the selected intermediate/generated output locations is read-only and
includes its decoded text, with 4,096-file and 32 MiB aggregate limits. External
source paths remain visible with an explicit warning and read-only marker; the
text API still applies the workspace root and symbolic-link restrictions.

## Assembly metadata

`MSBuildClient.projectMetadata(request, {signal})` returns
`{contextId, references, totalBytes}`. Every reference has `path`, `display`,
`aliases`, `base64`, `sha256`, `size` and an `identity` summary from the public
compiler inspection API. Omit `request.references` to select all references, or
provide paths exactly as returned by that authorized context. A path outside that
set fails with `SFMSB_METADATA_REFERENCE` and HTTP 403.

The Node entry exports `NativeMetadataReferenceService`. Its default limits are
512 selected references, 8 MiB per assembly and 32 MiB in total. It rechecks trust
before each file, reads through a bounded buffer, checks for concurrent file
changes and disposes every file handle. Invalid managed metadata and exhausted
budgets have stable diagnostic codes. The public metadata summary does not imply
support for executing arbitrary native reference assemblies.

`registerNativeProjectServices(registry, {engine})` installs these three service
operations and registers disposal. `startMSBuildHost` includes this contribution;
HTTP authorization, origin checks and structured error propagation remain shared
with the native transport.
