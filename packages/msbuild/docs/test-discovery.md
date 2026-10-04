# Portable framework discovery

`discoverPortableTests(input, options)` uses the public declaration frontend and
returns `{tests, diagnostics, symbols, backend}`. Input is source records, a source
string, `{trees}` or an already prepared symbol set. Each test uses the shared
stable test model, with project/method/row identity, traits, display name, source
span, arguments and lifecycle metadata. `symbols` remains an in-process execution
preparation graph; `tests` can be serialized independently.

`createPortableTestDiscoverers()` returns a fresh Map with `xunit`, `nunit` and
`mstest` entries. A supplied `options.discoverers` Map replaces it, allowing another
framework without editing a central dispatcher. `options.frameworks` selects
registry entries. The default final result bound is 100,000 tests; declaration
count/size bounds and cancellation remain enforced by the frontend.

Individual `discoverXunitTests`, `discoverNunitTests` and `discoverMstestTests`
accept prepared symbols and return test arrays. They use the same project,
data-resolution and cancellation options as the composite discoverer.

| Framework | Supported preparation |
| --- | --- |
| xUnit | Fact/Theory, InlineData, MemberData, ClassData, Skip/Trait, class and collection fixture declarations |
| NUnit | Test/TestCase/TestCaseSource, parameterized TestFixture, Category/Ignore/Explicit, setup/teardown and one-time lifecycle |
| MSTest | TestClass/TestMethod/DataTestMethod, DataRow/DynamicData, TestCategory/Ignore/Timeout and initialize/cleanup lifecycle |

Constant rows are inspected without running user code. Computed data is evaluated
in an isolated managed session through the preparation foundation; `backend`
selects source or CIL for that evaluation. Set `evaluateData: false` to prohibit
computed provider execution, or supply an asynchronous `resolveData` callback.
The callback receives the declaration and descriptor fields plus the abort signal.
`maxRows` defaults to 10,000. Providers must return an array of rows and stay within
the bound. Each scalar row is normalized to a one-argument row.

`resolveAttributeType` and `resolveConstant` preserve the frontend semantic hook
contract. Without a supplied resolved value, unresolved attribute/provider data is
retained as an explicit not-runnable reason. Missing providers, incorrect row
arity and inaccessible methods produce records rather than silently disappearing.
Syntax errors remain diagnostics on the discovery result. Cancellation rejects
with the original abort error; limits fail explicitly.

Discovery does not mark tests passed or mutate their project. NUnit explicit cases
remain identified for a run policy to select. Method invocation, fixture ownership,
results and progress are provided by the separate run adapter.

This is a documented portable framework profile. Framework reflection/plugins,
custom attributes and arbitrary native framework behavior are not implemented.
A missing native oracle does not establish parity: package-pinned discovery/name
and execution comparison remains a separate qualification obligation.
