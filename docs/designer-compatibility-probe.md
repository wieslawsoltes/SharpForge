# C# designer compatibility probe

`probeDesignSource(text, uri)` uses the shared syntax scanner to identify construction methods and direct constructors.
It scans the complete source for lexical errors and balanced delimiters, then parses candidate signatures through the shared C# parser.
It does not construct a design session, compile code, execute code, or authorize source writes.

## Measured scanner costs

The original `tests/a18-session-probe-benchmark.js` uses a 2,000-line, 63,627-character source with 1,992 integer fields.
At `b414433a`, Node 24.19.0 on Linux/x64 and AMD EPYC 9V74 recorded a 3.608 ms probe median and 12.702 ms p95.
The full design session comparison recorded 46.857 ms median and 61.187 ms p95.
These are the before measurements; the scanner corrections require an uninstrumented rerun before claiming an improvement.

The separate `tests/a18-session-probe-profile.js` preserves that fixture and its preceding session/probe warmup sequence.
The captured profile at `548b2899`, over 512 probes with a 250-microsecond sampling interval, attributed:

| Path | Sampled self time | Sampled inclusive time |
|---|---:|---:|
| Integer scanner | 558.045 ms | 601.581 ms |
| Identifier classification | 472.937 ms | 472.937 ms |
| Garbage collection | 311.048 ms | 311.048 ms |
| Delimiter/candidate collection | 147.920 ms | 147.920 ms |
| Constructor candidate enumeration | 99.870 ms | 99.870 ms |

The numeric samples concentrated on the decimal digit regular expression, separator removal, suffix matching and `BigInt` conversion.
Identifier samples concentrated on keyword membership and the keyed reserved-kind lookup.
Profiler timings include instrumentation and are diagnostic evidence, not acceptance benchmark results.

## Bounded correction

The shared integer scanner now recognizes plain decimal Int32 literals with at most ten digits and a value at most 2,147,483,647.
This avoids regular expressions, substring cleaning and `BigInt` conversion for that exact subset.
The candidate performs at most eleven character reads before declining; longer leading-zero sequences do not create an unbounded speculative scan.
Dots, separators, letters, escapes, non-ASCII continuations and overflow return to the existing general scanner.
That scanner retains responsibility for bases, suffixes, real numbers, exact large integers, malformed literals and their diagnostics.

The result contract remains unchanged: each call owns its mutable literal, error, feature and profile objects.
The outer scanner still adds the frozen token literal, exact source offsets and lossless trivia.
Cancellation remains in the shared token/trivia traversal.

Identifier classification uses a private lookup derived from immutable reserved-kind metadata and assigns the ordinary identifier kind directly.
The public `keywords` set remains authoritative on every call, including additions and removals.
The lookup also avoids inheriting unrelated `Object.prototype` properties when that set is extended with names such as `constructor`.
Unicode, formatting characters, escapes and verbatim identifiers continue through the existing identifier scanner.

There is no repeated-source result cache or separate designer lexer, and no public API was added.
These are localized changes in the shared syntax package, authorized for the A18 probe repair.

## Prepared qualification

`tests/a18-probe-scanner.test.js` covers exact records and offsets, mutable-result independence, numeric type and diagnostic boundaries,
the checked-in Roslyn 5.3 numeric reference, punctuation and Unicode recovery, keyword changes, constructor recognition,
trivia modes, cancellation and actual source/CIL execution of integer boundary operands.
The affected existing suites are `tests/syntax-lexing.test.js`, `tests/a18-compatibility-trivia.test.js`,
`tests/a18-session-compatibility.test.js` and `tests/a18-session-constructor-compatibility.test.js`.

Run validation only in the coordinated slot through `scripts/limited.js`.
The acceptance performance command remains `node scripts/limited.js node tests/a18-session-probe-benchmark.js`.
No native or Wasm execution result is implied by the prepared source/CIL tests.
