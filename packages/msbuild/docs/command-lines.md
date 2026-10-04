# Compiler command lines and structured diagnostics

The browser-safe `@sharpforge/msbuild` entry exports command-line and diagnostic parsers. They inspect
data and never invoke a compiler. The native engine's existing `parseDiagnosticLine` contract delegates
to the shared parser, so native job diagnostics use the same location and code handling.

`parseCscArguments(stringOrArray, options)` returns defines, references with aliases, analyzers,
additional files, analyzer configs, sources, language version, nullability, unsafe/checked flags,
warning policy, output path/kind, response-file references, and every unrecognized switch. Absolute
Unix source paths remain sources. The default input limits are 20,000 arguments and 1 MiB of text.

`expandCscResponseFiles(arguments, read, options)` expands response text through an explicit reader,
preserving order and unknown options. Cycles, excessive nesting, argument counts and aggregate text
reject explicitly. `splitCommandLine(text, options)` handles quoted paths and Windows backslash/quote
rules without a shell, with independent argument and text bounds.

`validateOutputProperties(properties)` rejects output paths that are absolute, traverse parent
directories or require property/percent expansion to understand. `validateBuildArguments(arguments,
{elevated})` additionally requires explicit elevated trust for external logger/toolset/output switches.
`validateResponseFiles(arguments, read, options)` applies that same policy recursively to at most
eight levels and 1 MiB of response text. Failures have `code: 'SFMSB_ARGUMENT_POLICY'` and status 400.
These are transport constraints; an explicitly trusted MSBuild target can still execute native code.

`parseDiagnosticLine(line)` preserves compiler, MSBuild, NuGet and SDK codes, project identity,
one-based start/end positions and help links while removing terminal styling and node prefixes.
`DiagnosticCollector.accept(line)` attaches continuation lines to the preceding diagnostic and
removes build-summary duplicates. Uncoded native errors receive `SFMSB_UNCODED`.

`parseSarif(documentOrText)` consumes bounded SARIF 2.1 results and retains severity, location,
suppression status, rule help links and related locations. The host's later artifact layer uses this
same parser; inspection itself does not read any local file or follow result URLs.

## Qualification and limits

The four product modules are unchanged from the completed native scope. The focused tests are
extracted from its policy, context and diagnostic cases. Both pinned Node22.23.3 and Node26.10.0
passed those scenarios on Linux/x64. The broader context qualification also captured ten actual
SDK10.0.201 Csc argument sets per Node version and retained them in native evidence. Six SDK-family
diagnostic corpora and Windows/macOS hosts were unavailable and are not claimed qualified.

This independent parsing layer is consumed by the queued host and project-context PRs. Full native
evidence remains in `planning/evidence/project18/native.json` in the integration stack and is reused
without dispatching a full native matrix for each PR.
