# Managed test preparation

`createManagedTestRuntime(discovery, options)` consumes a prepared declaration
set `{symbols, tests}`. Symbols use `discoverTestSymbols`; framework adapters
supply each test's identity, execution class, method/declaration span, arguments,
lifecycle stages and skip/not-runnable/explicit flags. This layer deliberately
does not discover frameworks or choose a project's tests.

The asynchronous factory lazily imports the compiler and ManagedInvocationSession.
`backend` is `source` (default) or `cil`; other values fail explicitly. An injected
`compiler` or `SessionType` uses the same contract for alternate implementations.
Compiler options are carried in `compileOptions`; the harness controls its own
entry point, output kind and assembly name. No package restore is performed.

The runtime exposes `backend`, `unavailable` (a Map from test ID to diagnostics),
`groups`, `diagnostics` and `hasRunnableTests`. Hosts call `initialize(options)`,
`initializeGroup(group, options)`, `execute(test, options)`,
`cleanupGroup(group, options)` and `cleanup(options)` in lifecycle order, then
`dispose()` in a finally block. Invocation options include the abort signal;
results carry managed return/fault, stdout, timing, statistics and source position.
Outcomes come from managed returns and faults, not console text parsing.

Every factory call owns its own heap/static state. xUnit class and collection
fixtures, NUnit shared instances and MSTest lifecycle methods are represented as
ordinary managed calls in an in-memory generated harness. Source attributes are
blanked without changing file length or line breaks. Original files remain intact.
Pure constant iterator providers referenced only by discovery attributes may be
removed from this copy; executable references, fields, constructors or missing
reference evidence prevent removal. Computed providers run in a separate bounded
managed session before execution preparation.

`portableAssertionSource()` returns managed framework contract source, and
`portableAssertionCapabilities` lists the supported assertions for xUnit, NUnit
and MSTest. Unknown APIs remain compile diagnostics. The implementation does not
substitute successful no-ops for missing native framework behavior.

Preparation excludes explicitly skipped/non-runnable tests and unselected
explicit cases. Up to eight compile-recovery passes can exclude separately
located invalid test methods while retaining supported neighbors. Whole-harness
failures mark all remaining tests unavailable. Default invocation instruction and
output limits are 2,000,000 and 1,000,000 characters; computed data defaults to
500,000 instructions, 100,000 output characters and 10,000 rows. Session APIs
retain cancellation and fatal-fault isolation.

This is a closed managed framework profile. Native framework reflection/plugins,
external assertion extensions and unsupported managed APIs remain outside it.
Framework discovery, run ordering, test results and progress sessions are separate
dependent modules. Rust native/Wasm execution is not provided by this factory.
