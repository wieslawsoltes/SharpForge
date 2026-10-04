# Native launch and publish profiles

`MSBuildClient.runProject(request, {signal})` runs a project through the registered
`project/run` contribution. Supply the selected native context fields and explicit
`trusted: true`. A `profile` selects saved `Properties/launchSettings.json` data;
`profile: null` or `noLaunchProfile: true` disables saved profile selection.

Callers can instead provide `runOptions` from the public project-system launch
model: `{project, profile, commandName, args, environment, workingDirectory,
executablePath, applicationUrl}`. The project/profile must match the request.
`request.arguments` and `request.workingDirectory` override their corresponding
profile fields. Arguments are passed as a vector and are never shell-expanded.
Application environment variables come only from the explicit profile data plus
the host's permitted tool-discovery inheritance. `applicationUrl` supplies
`ASPNETCORE_URLS` unless explicitly set, and the selected profile supplies
`DOTNET_LAUNCH_PROFILE`.

`Project` profiles use the fixed SDK `dotnet run` command with
`--no-launch-profile`; resolved profile data is applied consistently by the host.
The default is `--no-build`, which can be disabled with `noBuild: false`.
`Executable` profiles use a literal executable file inside the granted workspace.
The executable path and working directory are relative to the project directory.
Both are checked against the workspace root and symbolic-link policy. External
executables and other command types require a separate permitted adapter and fail
with an explicit diagnostic. The shared queue, output/argument limits, timeout,
cancellation and process cleanup apply to both supported command types.

The Node entry exports `runNativeProject(engine, request, options)`. Its result is
the native process result, including exit status, captured output, timing and
cancellation/timeout state.

## Publish profiles

`publishProfiles({project})` discovers `Properties/PublishProfiles/*.pubxml` as
bounded workspace text. UTF-16 with or without a BOM uses the shared file codec;
binary content and oversized files are rejected. Results contain `name`, `path`,
visible `properties`, `diagnostics` and `inspectionOnly: true`. Literal property
values have `evaluated: true`; conditions and property/item/metadata expressions
remain explicit data for native evaluation.

`publishProfile({project, profile, trusted: true, ...context})` selects an existing
profile by name and starts the shared native `publish` job. Inspect its progress
and artifacts with the normal job API. Literal `PublishDir` values pass the
native output-property policy before invocation; the native SDK handles profile
imports, conditions and publish targets.

The Node entry exports `inspectPublishProfile`, `discoverPublishProfiles`,
`createPublishProfileRequest` and `registerNativePublishServices`. Read-only
profile inspection does not execute MSBuild; launching and publishing use the
explicit native trust gate.
