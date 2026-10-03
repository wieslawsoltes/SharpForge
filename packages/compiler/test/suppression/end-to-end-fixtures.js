/**
 * End-to-end warning-suppression fixtures (SF-A02-T37): programs inside the execution profile, so that `compile()`
 * produces the diagnostics itself and its final list can be compared with Roslyn's. The oracle pins them in
 * roslyn-suppression-end-to-end.json (the `expected` list of each fixture); generate.js refreshes it.
 *
 * Roslyn's rule for SuppressMessageAttribute is part of the pin: csc applies it to analyzer diagnostics only, so a
 * compiler warning (CSxxxx) named by the attribute is still reported.
 */
const source = text => ({ uri: 'a.cs', text });

/** One class whose methods each produce one or two known compiler warnings. */
const members = (first = '', second = '', third = '') => `class C
{
${first}    static void A() { int a; }
${second}    static void B() { int b = 1; }
${third}    static void D() { int d; int e = 2; }
}
`;
const attributed = `using System.Diagnostics.CodeAnalysis;
[assembly: SuppressMessage("Compiler", "CS0168", Scope = "member", Target = "~M:C.D")]
[SuppressMessage("Compiler", "CS0219")]
class C
{
    [SuppressMessage("Compiler", "CS0168")]
    [SuppressMessage("Compiler", "CS0168:Variable is declared but never used", Justification = "pinned")]
    static void A() { int a; }
    static void B() { int b = 1; }
    static void D() { int d; }
}
`;
const withError = `class C
{
#pragma warning disable CS0165
#pragma warning disable 0103
#pragma warning disable
    static void A() { int a; int b = a; int c = missing; int d; }
}
`;

/** `fixture(name, text, options)`: one source file `a.cs` compiled as a library with the given warning options. */
const fixture = (name, text, options = {}) => ({ name, sources: [source(text)], options });

export const fixtures = [
  fixture('no suppression', members()),
  fixture('SuppressMessage does not suppress compiler warnings', attributed),
  fixture('SuppressMessage with nowarn for the same id', attributed, { noWarn: ['CS0168'] }),
  fixture('SuppressMessage with treat warnings as errors', attributed, { treatWarningsAsErrors: true }),
  fixture('pragma disable without ids, then restore', members('', '#pragma warning disable\n', '#pragma warning restore\n')),
  fixture('pragma disable with an id, then restore the id', members('#pragma warning disable CS0168\n', '', '#pragma warning restore CS0168\n')),
  fixture('pragma disable several ids', members('#pragma warning disable CS0168, CS0219\n', '#pragma warning restore CS0219\n', '')),
  fixture(
    'pragma numeric ids without the CS prefix',
    members('#pragma warning disable 168\n', '#pragma warning disable 0219\n', '#pragma warning restore 168, 219\n'),
  ),
  fixture('pragma enable with an id', members('#pragma warning disable CS0168\n', '#pragma warning enable CS0168\n', '')),
  fixture('pragma enable without ids', members('#pragma warning disable\n', '#pragma warning enable\n', '')),
  fixture('pragma enable overrides nowarn', members('', '#pragma warning enable CS0168, CS0219\n', ''), { noWarn: ['CS0168', 'CS0219'] }),
  fixture('pragma enable is not a promotion to error', members('#pragma warning enable CS0168\n', '', ''), { warnAsError: ['CS0219'] }),
  fixture('pragma disable of an error does not suppress it', withError),
  fixture('nowarn of an error id does not suppress it', withError, { noWarn: ['CS0165', '103'] }),
  fixture('warnaserror+ for one id', members(), { warnAsError: ['CS0168'] }),
  fixture('warnaserror+ for a numeric id', members(), { warnAsError: ['219'] }),
  fixture('warnaserror with warnaserror- for one id', members(), { treatWarningsAsErrors: true, warnNotAsError: ['CS0168'] }),
  fixture('warnaserror- for a numeric id', members(), { treatWarningsAsErrors: true, warnNotAsError: ['0219'] }),
  fixture('nowarn for one id', members(), { noWarn: ['CS0219'] }),
  fixture('nowarn with pragma restore', members('', '#pragma warning restore CS0168\n', ''), { noWarn: ['CS0168'] }),
  fixture(
    'nowarn with pragma disable of another id',
    members('#pragma warning disable CS0219\n', '', '#pragma warning restore CS0219\n'),
    { noWarn: ['168'] },
  ),
  fixture('warnaserror+ with pragma disable of the same id', members('', '', '#pragma warning disable CS0168\n'), { warnAsError: ['CS0168'] }),
  fixture(
    'warnaserror with pragma disable and restore',
    members('#pragma warning disable CS0168\n', '#pragma warning restore CS0168\n', ''),
    { treatWarningsAsErrors: true },
  ),
  fixture('nowarn and warnaserror+ for the same id', members(), { noWarn: ['CS0168'], warnAsError: ['CS0168', 'CS0219'] }),
  fixture(
    'warnaserror+, warnaserror- and nowarn combined with pragma',
    members('#pragma warning disable CS0219\n', '#pragma warning restore CS0219\n', ''),
    { treatWarningsAsErrors: true, warnNotAsError: ['CS0219'], noWarn: ['CS0168'] },
  ),
];
