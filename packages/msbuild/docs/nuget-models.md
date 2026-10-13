# NuGet configuration and restore models

The browser-safe MSBuild entry exposes these pure data contracts. They do not
perform restore, execute project files or retrieve network resources.

| Contract | Result and behavior |
| --- | --- |
| `parseNuGetVersion(text)` | Normalized components and prerelease/build metadata; legacy fourth revision retained. |
| `compareNuGetVersions(left, right)` | Negative/zero/positive precedence; build metadata is ignored and prerelease text compares without case distinctions. |
| `parseNuGetRange(text)` | Lower/upper bounds and inclusion flags, or numeric/prerelease floating prefixes. |
| `satisfiesNuGetRange(version, range)` | Range membership, including floating release/prerelease rules. |
| `parseNuGetConfiguration(records)` | Effective sources, source mappings, safe settings and provenance from ordered `{path, text}` records. |
| `sourcesForPackage(configuration, id)` | Enabled sources with the most specific matching source-mapping pattern. |
| `redactFeedUrl(value)` | URL without user/password data; query values are redacted. Local filesystem paths remain paths. |
| `readProjectAssets(input, options)` | Version-3 graph by TFM/RID, with direct/transitive labels and restore diagnostics. |
| `readPackagesLock(text)` | Version-1/2 lock document with original text and a change baseline. |
| `writePackagesLock(lock)` | Exact original formatting when unchanged; formatted JSON after document changes. |
| `detectLockDrift(lock, referencesByFramework)` | `NU1004` diagnostics for missing, removed or unsatisfied direct dependencies. |
| `lockedRestoreRequest(request, options)` | Native restore request with lock generation and explicit locked-mode properties. |
| `parseCentralPackages(text)` | Literal central versions/global references and transitive-pinning policy. Constructs needing evaluation are rejected. |
| `resolveCentralPackages(references, central, options)` | Evaluated central versions and `NU1008`/`NU1010`/`NU1013` policy diagnostics. |

Configuration records are supplied from lower to higher precedence. `clear`,
`remove` and `add` compose their sections; source mappings choose exact matches
before longer prefixes and `*`. Credentials are represented only by presence
flags and never copied to the result. Unknown configuration keys are reported by
name and omitted from the visible settings object.

The assets model preserves restore decisions and asset paths without attempting a
second dependency solve. The input JSON string is bounded to 128 MiB and the
library count defaults to 50,000. Lock input is bounded to 32 MiB. Configuration
has at most 128 records, each parsed with a 2 MiB text limit; version-range text is
bounded to 1,024 characters.

Central imports, conditions, choices and expressions must be evaluated by the
native or portable project engine first. The literal parser rejects those inputs
instead of reporting an invented effective policy. The resolver accepts evaluated
records, applies allowed `VersionOverride` values, preserves global package
references, and reports missing declarations or prohibited inline versions.

Network V3 resources, package archives and native mutation/restore services are
separate contributions that consume these contracts. Platform qualification and
external-feed availability are documented independently from pure model support.
