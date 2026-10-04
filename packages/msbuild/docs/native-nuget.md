# Native NuGet services

`registerNativeNuGetServices(registry, { engine, workspace }, options)` contributes
the `nuget` service family. The default native host composition includes it.
`MSBuildClient.packageOperation(operation, request, options)` calls the same
bounded authenticated HTTP service; `options.signal` cancels transport and
supported feed/query work.

| Operation | Result and behavior |
| --- | --- |
| configuration | Effective inherited/ancestor NuGet.Config sources, enablement and mapping, without credential values |
| assets | Evaluated project.assets.json identities, compile/runtime/native assets and restore diagnostics |
| lock | Parsed packages.lock.json data from the selected project directory |
| restore | An explicit SDK restore job, locked by default; returns the normal job handle |
| change | Lossless add/update/remove project or central version edit, save conflict checks and an SDK restore job |
| consolidate | Sequential update across at most 128 selected projects, returning each change result |
| query | Real SDK JSON package listing, including optional vulnerable/deprecated/outdated mode |
| search | Configured V3 source package search |
| versions | Configured V3 package versions |
| registration | Paged V3 registration catalog metadata |
| nuspec | Selected package nuspec text |
| vulnerabilities | Configured V3 vulnerability records |

`readNuGetConfiguration(directory, { inheritedFiles })` is available from the
Node entry. It applies explicitly supplied inherited files and root-to-project
ancestor configuration in deterministic order, using the shared pure parser.
Source credentials stay on the host. Optional `nugetCredentials(sourceName, url)`
resolves credentials there; `nugetOrigins` explicitly allows additional feed
resource origins. Credential-bearing source URLs are rejected; configure a credential-free URL
and use the host credential provider. The browser receives no credential values. Feed clients use bounded resources,
redirect rejection and a per-host configured-source cache.

`NuGetPackageService(engine, workspace = engine.workspace)` exposes `change`,
`consolidate` and `query`. Mutating requests require the engine's explicit trust
policy. `change({project,id,version,operation,centralPath, trusted})` preserves
comments, XML whitespace and quote style through the public lossless item edit
API. Central additions remove inline Version/VersionOverride and update the
chosen PackageVersion entry. Removal deletes the literal package reference.
Writes use expected hashes and preserve the workspace's encoding policy. The
result includes saved records, restoreJobId, edit undo metadata and `atomic:false`.
Multi-file and multi-project workflows report that they are not atomic; restore
failure is observed through the normal job API rather than hidden.

Query uses a fixed SDK invocation and explicit mode switches; callers do not
supply arbitrary shell text. Nonzero SDK exits and malformed/missing JSON fail
explicitly. Unknown package operations, package IDs/ranges, query modes and
unconfigured/disabled sources are rejected.

Qualification combines recorded V3 HTTP responses with an actual installed SDK
and three locally packed feed packages. The native workflow verifies edit
preservation, SDK source parity, direct/transitive assets, lock drift (NU1004),
update/remove and central versions. Public external-feed connectivity and other
OS/architecture qualification remain separately reported limitations.
