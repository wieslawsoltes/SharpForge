# Native test format and argument contracts

These browser-safe APIs are exported by `@sharpforge/msbuild`. They transform
bounded records and text; they do not execute a process or read an attachment.
The native adapter is a separate contribution.

## Discovery and identity

`parseNativeTestDiscovery(output, {project, sourceTests, maxTests, backend, signal})`
returns `{tests, diagnostics}`. It recognizes the English VSTest listing markers
and structured `test`/`test-discovered` JSON lines, preserving native IDs and
enriching results from independently discovered source records. Matching source
display names/FQNs retain portable IDs, traits, arguments and source coordinates.
Duplicate resulting test IDs are coalesced. Unrecognized output yields SFT2303
and remains available to the caller; it is not treated as successful discovery.
Input is capped at 32 million characters, source metadata at 100000 records and
discovered tests at 100000 by default. Cancellation is checked for each line.

`createTestDiscoveryArguments(request)` produces an argument array for explicit
`vstest`, `mtp` or `mtp-bridge` runner mode, with project/solution, configuration,
framework and optional no-build selection. The caller supplies and authorizes the
executable; these arguments are not a shell command. Locale-dependent textual
listings and every external runner version are not qualified by this parser.

## Selection and run arguments

`testSelectionFilter(tests)` accepts 1–10000 cases or FQN strings, removes duplicate
names and escapes VSTest filter operators. Names reject control characters, empty
values and lengths over 4096. It returns one argument value, not shell text.

`createTestRunArguments(request, resultsDirectory)` adds explicit TRX output,
optional selection and coverage. VSTest uses a single escaped filter argument and
XPlat coverage; MTP modes require native test UIDs and explicit TRX/Cobertura host
extensions. Legacy runsettings are accepted only for VSTest. Unsupported modes,
missing MTP UIDs and incompatible settings fail before execution.

## Reports and navigation

`parseTrx(source, {project, sourceTests, backend, signal, maxTests})` returns
`{tests, results, runId, outcome, counters, attachments}`. It reads namespaced TRX
definitions, outcomes, duration, stdout/stderr, messages, stacks and attachment
references. Unknown outcomes produce a not-runnable result with SFT2301. Duration
uses `parseTestDuration(timeSpan)` in milliseconds, including seven-digit fractions
and optional day components. XML is capped at 32 million characters, one million
nodes and depth 128; results default to 100000. Attachments are references only:
the host must separately authorize a retained artifact before reading it.

`parseCobertura(source, {workspaceRoot, signal, maxLines = 1000000})` returns
`{format, files, diagnostics, coveredLines, totalLines}`. Files and lines are sorted;
duplicate line hits/branch counts use their maximum rather than double-counting.
Malformed counts fail. Paths outside the workspace produce SFT2302 and are omitted.
Source lines are one-based; input is capped at 32 million characters and depth 128.

`mapTestSource(test, {stackTrace, symbols, methodTokens, declarations, workspaceRoot})`
prefers stack-frame coordinates, then the first visible Portable PDB sequence
point, then discovered declarations and finally the test's existing source record.
It returns coordinates/provenance; it does not grant access to that source file.

The public test model defines result outcomes. Console success is never a
substitute for a parsed per-test result. Actual framework packages and native
platform coverage require the separately recorded native qualification.
