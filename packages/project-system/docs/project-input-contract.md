# Compilation and launch inputs

`projectCompilationOptions(project)` translates one evaluated context into
compiler settings. The input contains `path`, `name`, `outputType`, normalized
lowercase `properties`, and optional `generatedSources`. The returned object
retains output kind, language version, nullable policy, defines, overflow and
unsafe settings, warning policy, optimization, deterministic output, root
namespace, assembly name and generated global-using text. It validates values
and throws `SFP1402` for unsupported or malformed compiler settings.

Defines and suppressed warning IDs are deduplicated. SDK warning defaults are
included only when `usingmicrosoftnetsdk` is true. The helper reads supplied
context data; it does not evaluate XML, choose a framework, compile sources or
silently merge settings from another context.

`readLaunchSettings(source, {path, profile, maxLength})` reads JSONC profiles
through the shared configuration parser. It returns `profiles`,
`activeProfile`, and located `diagnostics`. A missing explicit profile,
malformed JSON/profile/environment, oversized text or more than 100 profiles
produces `SFP1701`. The default source limit is 1,000,000 UTF-16 code units.

`parseLaunchArguments(text)` handles quoted arguments, empty quoted values and
backslash escapes without a shell. Unterminated quoting and text above 65,536
characters throw `SFP1701`.

`projectRunOptions(project, options)` combines the selected launch profile with
the supplied context identity. It returns project/context/framework/RID,
command name, argument array, environment, working directory, executable path
and application URL. Explicit `options.args` overrides profile arguments.
Profile environment values override host-supplied default values; an
application URL supplies `ASPNETCORE_URLS` only if that variable is absent.

The data model retains `Project` and `Executable` command profiles. Other
command names remain visible but `projectRunOptions` rejects them as requiring
their native host. These helpers do not start a process, open a browser or
grant native execution. The consuming host applies its authorization,
environment and executable boundaries.
