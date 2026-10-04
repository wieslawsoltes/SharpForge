# @sharpforge/templates

Deterministic project and item generation, explicit target capabilities, a data-only .NET template engine, and installable template package catalogs. File plans contain all generated records and source-preserving project/solution edits; callers own the explicit destination transaction.

```js
import {
  createProjectPlan, createItemPlan, searchTemplates, TemplateCatalog,
  installTemplatePackage, instantiateTemplate
} from '@sharpforge/templates';

const project = createProjectPlan('console', {
  projectName: 'Demo', namespace: 'Example.Demo',
  framework: 'net10.0', useProgramMain: false,
  nullable: 'enable', implicitUsings: true, solutionFormat: 'sln'
});
const item = createItemPlan('interface', {
  name: 'IWorker.cs', namespace: 'Example.Demo', namespaceStyle: 'file-scoped'
});

const catalog = new TemplateCatalog();
const installed = installTemplatePackage(nupkgBytes, { catalog });
const choices = searchTemplates({ catalog, query: 'console' });
const files = instantiateTemplate(config, sourceFiles, {
  name: 'Example', parameters: { Framework: 'net10.0' }, output: 'src/Example'
});
```

## Catalogs and targets

The original `projectTemplates` (11) and `itemTemplates` (19) exports remain the qualified browser example inventory, preserving existing consumers and example bytes. `searchTemplates` and `TemplateCatalog` expose the full catalog. Installation changes only the supplied catalog; no process-global mutable installation state exists. `templateAvailability(template, environment)` returns a reason when a native SDK or Windows prerequisite is missing. File generation remains possible for inspection/export without claiming execution on the current host.

A trusted source contribution consists of one module exporting its definition and `generate` function, as in `examples/notice-template.mjs`. Add that definition to a caller-owned `TemplateCatalog`; search and plan generation use the same public APIs and the shipped catalog remains unchanged. Nupkg installation uses the data-only engine described below.

Every shipped definition now lives in one `src/project/*.template.js` or `src/item/*.template.js` module. A new builtin
exports `template` with its generator and explicit qualification targets; optional `order` controls stable catalog order.
The existing build-contribution pipeline discovers these trusted repository modules and creates the distribution index,
so adding a builtin requires one authored module and no central registry/import-list edit. Shared generators remain
separate by responsibility. The released 11-project/19-item example inventories retain their original order and shapes.
Run `node packages/templates/build-catalog.js --write` to refresh the checked-in generated index for source/CLI consumers;
`--check` detects a stale index. The static browser build generates its own index automatically. Generated index changes
are mechanical build artifacts. No template generator runs during catalog search, and installed package JavaScript is
never included in this discovery mechanism.

| Family | Generated files | Execution requirement |
| --- | --- | --- |
| Console, async, class library, empty, self-test, composite solutions | SDK projects, source, SLNX or classic SLN | Existing SharpForge managed profile; native SDK compatibility is separately qualified |
| Original WinUI web templates | Code-first controls, pages, navigation and libraries through `.View` | SharpForge's shipped WinUI web profile |
| xUnit / NUnit / MSTest | SDK test project, pinned framework/adapter/Test SDK references, one passing test body | Native `dotnet restore`, `dotnet build`, `dotnet test`; browser framework execution is unavailable |
| Windows App SDK | Unpackaged and MSIX app, XAML library, MSTest UI app, manifests and correctly sized PNG assets | Windows/.NET/Windows SDK; package pin matches repository Windows oracle `1.8.260921001`; build/run qualification remains required |
| Core C# items | Interface, record, struct, enum, delegate, exception, attribute, extension methods, top-level Program, test classes | Nine package-free items compile/run on native .NET 10; test items add package references and require separate restored-framework qualification |
| Configuration | `global.json`, `nuget.config`, `.gitignore`, `.gitattributes`, `Directory.Packages.props`, local tools, launch settings, manifest, app settings | Data files; SDK version defaults to `10.0.100` with `latestFeature` roll-forward |
| Native WinUI XAML items | Page/Window/UserControl/ContentDialog pairs, `DependentUpon`, styles/resources, Generic.xaml control, templates | Generated literal pairs support browser designer source sync; native partial classes and XAML resource/binding execution require the Windows App SDK compiler |
| Animations and MVVM | Portable code-first opacity storyboard; native storyboard/transition/states; observable model, RelayCommand and complete Home/Settings shell | Portable storyboard runs on source and CIL; observable model and commands run on native .NET 10; XAML/x:Bind/native navigation require Windows qualification |

`normalizeTemplateOptions` validates framework, language version, nullable state, implicit usings, explicit Main/top-level syntax, restore reporting, output type, namespace style and solution format. Generating a framework name never installs an SDK. Invalid identifiers, values, path aliases, file-as-parent conflicts and unknown template IDs produce explicit diagnostics. `validateFilePlan` checks every generated destination and parent. `modifications` retain `expectedText` for conflict detection; applying a plan must recheck those values.

## .NET template engine

`parseTemplateConfig` accepts bounded JSON with comments and records typed parameters, choices and defaults, including the SDK's `datatype` spelling. `evaluateTemplateSymbols` resolves parameter, computed, generated, derived and explicitly bound symbols with cycle/depth limits. Expressions are interpreted without JavaScript evaluation or method/property invocation. Supported generated operations include constant, casing, regex, regexMatch, join, switch, evaluate, deterministic GUID/random/port and an explicit-time `now`. Value forms include casing, safe identifiers/namespaces, replace and chain. Unknown constructs produce `SFTPL010`–`SFTPL019` diagnostics.

GUID/random/port values are reproducible from the supplied seed or template identity/name. They are template values, not security credentials. `now` requires a supplied timestamp. Regexes reject backreferences, lookarounds, group repetition and ambiguous unbounded repetition, and have explicit input/pattern limits. A single repeated literal/character class is supported; other repetitions are bounded.

`instantiateTemplate` applies sourceName/symbol substitutions to content and paths, include/exclude/rename/copyOnly rules and conditional source modifiers. Line-based `#if`, `#elseif`/`#elif`, `#else`, `#endif` work in C#, JSON comments and XML comments; retained lines keep their original endings. Template-owned MSBuild conditions and safe namespace forms are resolved; runtime properties such as `Configuration` remain for MSBuild. Binary data remains binary. Source/output counts, paths and bytes are bounded; archive/package limits remain independently enforced.

Template packages are ZIP/nupkg data. Every configuration and identity is checked before the catalog is changed. Post-actions—including restore, open-file and process actions—are reported as manual steps with their arguments/instructions. They never execute on import or creation. The project wizard adapter accepts installed templates that generate exactly one project; direct `instantiateTemplate` supports a complete multi-project file plan.

The native qualification suite compares the actual Microsoft .NET SDK 10.0.401 console template (default, explicit Main, C# 7.3 and hyphenated project name) and class-library template byte for byte with `dotnet new`, then builds with `NativeMSBuild` and runs console outputs. This establishes those concrete scenarios. General-purpose custom operation providers are rejected with a diagnostic; arbitrary MSBuild evaluation, script execution and full .NET Template Engine parity are not provided.

The generated configuration suite also executes SDK selection, NuGet source listing, empty local tool restore, solution listing, central package property evaluation, launch profiles and Git ignore/attribute commands. The `appsettings.json` keys match the installed SDK's `dotnet new web` output. The observable model and RelayCommand run on native .NET, checking change notifications, duplicate-value suppression, command gating and reset behavior. These results do not establish Windows XAML binding or navigation behavior.

`validateTemplateQualifications(catalog, { target, observations })` rejects any selected declared target without a passing observation naming its actual engine and evidence. Skipped or wrong-target results cannot qualify an entry. The browser inventory is executed on source and direct CIL in `tests/template-qualification.test.js`; native project and item qualification is opt-in through `SHARPFORGE_TEMPLATE_NATIVE=1` with an installed SDK. Windows App SDK targets remain unqualified until their Windows runner records builds and runtime behavior.

### Windows qualification

The native WinUI test template is an unpackaged executable. Its generated XAML `App` owns the UI thread,
starts the pinned MSTest 3.8.3 runner, publishes the window dispatcher for `UITestMethod`, and returns the
runner's exit code. A `finally` block closes the window and exits the application. It includes a normal
arithmetic test and a real UI-thread control test. `dotnet run -p:Platform=x64` launches that test host;
it does not depend on the VSTest unpackaged application launcher. The lifecycle follows Microsoft's
[WinUI/MTP guidance](https://learn.microsoft.com/dotnet/core/testing/unit-testing-mstest-winui), using the
[dispatcher API available in MSTest 3.8.3](https://github.com/microsoft/testfx/blob/v3.8.3/src/TestFramework/TestFramework.Extensions/Attributes/WinUI_UITestMethodAttribute.cs).

On a Windows desktop runner with the Windows SDK, restore access and .NET 10, run
`SHARPFORGE_TEMPLATE_NATIVE=1 node scripts/limited.js node --test tests/a24-08-windows-qualification.test.js`
(set the environment variable using the host shell's syntax). The suite builds all four native project
templates; executes the MSTest app with both passing and deliberately failing tests; and builds/runs an
application composed from actual item plans. That application checks default control rendering,
dictionary keys, literal XAML pairs, code/XAML storyboards, transitions, visual states, two-way settings
bindings and Home/Settings navigation. Invalid navigation leaves the current page intact. Theme and
visual-state page templates include compilable XAML/code-behind pairs and project membership metadata.

Linux runs only the portable plan checks and report the five Windows execution cases as skipped.
Authoring this harness is not evidence of a successful Windows build or runtime run. A Windows result
is still required before the native qualification gate can pass.

## Destinations and examples

The Studio wizard includes explicit directory selection, resolved folder display, target prerequisites, preview and exact overwrite confirmation. Canceling the picker leaves the wizard open. Project-system `preflightDestination` checks all paths, permissions and an optional supplied quota estimate. The wizard passes `mode:'merge'` to `writeNewDirectory`, which journals creations and backups, rolls back failures/cancellation and reports precise leftovers. The public writer retains strict-empty saves and explicit partial-failure receipts by default. File System Access has no cross-process atomic multi-file transaction.

Run `node packages/templates/examples/catalog.mjs` to generate and inspect every catalog entry. Focused tests use `a24-07`, `a24-08`, `a24-09`, and `a24-20` prefixes. The legacy `templates-archive` and `template-examples` regression tests remain unchanged. Native test-framework restore/build/run and Windows App SDK qualification are recorded separately; unavailable packages or platforms remain visible in the evidence.
