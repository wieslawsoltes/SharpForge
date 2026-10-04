/**
 * Reference-manager fixtures (SF-A02-T22): the assemblies the generator builds with Roslyn and the scenarios whose
 * Roslyn diagnostics are pinned in `pinned.json` and replayed through `compile(source, { references })`.
 *
 * Every assembly and scenario is compiled against the core library `tests/fixtures/metadata/MiniStandard.dll`
 * (no other framework reference). Strongly named assemblies are public-signed with the fixture key.
 */
const version = text => `[assembly: System.Reflection.AssemblyVersion("${text}")]\n`;
const library = 'namespace Lib { public class Widget { public int Size; } public class Gadget { public Widget Owner; } }\n';
const consumer =
  'namespace App {\n' +
  '  public class Holder : Lib.Widget { public Lib.Gadget Make(Lib.Widget seed) { return null; } }\n' +
  '  public class Plain { public int Count; public Lib.Widget Hidden; }\n' +
  '}\n';
const forwarded = type => `[assembly: System.Runtime.CompilerServices.TypeForwardedTo(typeof(${type}))]\n`;
const forwarders = forwarded('Lib.Widget') + forwarded('Lib.Gadget') + 'namespace Facade { public class Marker { } }\n';

/**
 * A library with closed classes as the pinned proposal emits them (csharp-15.0/closed-hierarchies.md revision 1,
 * "Lowering"): abstract and marked `[IsClosedType]`. Roslyn 5.3 has no `closed` modifier, so the attribute is written
 * out; the `[CompilerFeatureRequired("ClosedClasses")]` of the constructors cannot be written in source (CS8335).
 */
const closedLibrary =
  'namespace System.Runtime.CompilerServices { public sealed class IsClosedTypeAttribute : System.Attribute { } }\n' +
  'namespace Shapes {\n' +
  '  [System.Runtime.CompilerServices.IsClosedType] public abstract class Shape { protected Shape() { } public int Sides; }\n' +
  '  public class Circle : Shape { }\n' +
  '  public sealed class Square : Shape { }\n' +
  '  [System.Runtime.CompilerServices.IsClosedType] public abstract class Solid : Shape { }\n' +
  '  public abstract class Open { }\n' +
  '}\n';

/** `file` is the checked-in name; `name` the assembly name; `build: false` assemblies only exist while generating. */
export const assemblies = [
  { file: 'Lib.1.0.0.0.dll', name: 'Lib', strong: true, source: version('1.0.0.0') + library },
  { file: 'Lib.1.0.0.0.other.dll', name: 'Lib', strong: true, source: version('1.0.0.0') + library + 'namespace Lib { public class Extra { } }\n' },
  { file: 'Lib.1.0.0.5.dll', name: 'Lib', strong: true, source: version('1.0.0.5') + library },
  { file: 'Lib.2.0.0.0.dll', name: 'Lib', strong: true, source: version('2.0.0.0') + library },
  { file: 'Consumer.Lib1.dll', name: 'Consumer', strong: true, source: version('1.0.0.0') + consumer, references: ['Lib.1.0.0.0.dll'] },
  { file: 'Consumer.Lib2.dll', name: 'Consumer', strong: true, source: version('1.0.0.0') + consumer, references: ['Lib.2.0.0.0.dll'] },
  { file: 'Weak.1.0.0.0.dll', name: 'Weak', strong: false, source: version('1.0.0.0') + 'namespace Weak { public class Thing { } }\n' },
  { file: 'Weak.2.0.0.0.dll', name: 'Weak', strong: false, source: version('2.0.0.0') + 'namespace Weak { public class Thing { } }\n' },
  { file: 'Closed.dll', name: 'Closed', strong: false, source: version('1.0.0.0') + closedLibrary },
  { file: 'Facade.old.dll', name: 'Facade', strong: true, build: false, source: version('1.0.0.0') + library },
  { file: 'Facade.dll', name: 'Facade', strong: true, source: version('1.0.0.0') + forwarders, references: ['Lib.2.0.0.0.dll'] },
  {
    file: 'FacadeConsumer.dll',
    name: 'FacadeConsumer',
    strong: true,
    source: version('1.0.0.0') + 'namespace Client { public class Shelf : Lib.Widget { public Lib.Gadget First; } }\n',
    references: ['Facade.old.dll'],
  },
];

const main = body => `class Program {\n  static void Main() {\n${body}  }\n}\n`;
const useHolder = main('    App.Holder holder = new App.Holder();\n    holder.Size = 1;\n');

export const scenarios = [
  // ---- identity match and unification ----
  { id: 'match/exact-version', references: ['Lib.1.0.0.0.dll', 'Consumer.Lib1.dll'], source: useHolder },
  { id: 'unify/higher-major-version', references: ['Lib.2.0.0.0.dll', 'Consumer.Lib1.dll'], source: useHolder },
  { id: 'unify/higher-build-version', references: ['Lib.1.0.0.5.dll', 'Consumer.Lib1.dll'], source: useHolder },
  { id: 'unify/lower-version', references: ['Lib.1.0.0.0.dll', 'Consumer.Lib2.dll'], source: useHolder },
  {
    id: 'unify/member-signature',
    references: ['Lib.2.0.0.0.dll', 'Consumer.Lib1.dll'],
    source: main('    App.Plain plain = new App.Plain();\n    plain.Hidden = null;\n'),
  },
  {
    id: 'unify/unused-dependency',
    references: ['Lib.2.0.0.0.dll', 'Consumer.Lib1.dll'],
    source: main('    App.Plain plain = new App.Plain();\n    plain.Count = 1;\n'),
  },
  // ---- duplicate references ----
  {
    id: 'duplicate/same-identity-different-content',
    references: ['Lib.1.0.0.0.dll', 'Lib.1.0.0.0.other.dll'],
    source: main('    Lib.Widget widget = new Lib.Widget();\n    widget.Size = 1;\n'),
  },
  {
    id: 'duplicate/strong-different-versions',
    references: ['Lib.1.0.0.0.dll', 'Lib.2.0.0.0.dll'],
    source: main('    Lib.Widget widget = new Lib.Widget();\n    widget.Size = 1;\n'),
  },
  {
    id: 'duplicate/weak-different-versions',
    references: ['Weak.1.0.0.0.dll', 'Weak.2.0.0.0.dll'],
    source: main('    Weak.Thing thing = new Weak.Thing();\n    thing.ToString();\n'),
  },
  // ---- a type from an assembly that is not referenced ----
  { id: 'missing/base-type', references: ['Consumer.Lib1.dll'], source: useHolder },
  {
    id: 'missing/member-signature',
    references: ['Consumer.Lib1.dll'],
    source: main('    App.Plain plain = new App.Plain();\n    plain.Hidden = null;\n'),
  },
  {
    id: 'missing/not-used',
    references: ['Consumer.Lib1.dll'],
    source: main('    App.Plain plain = new App.Plain();\n    plain.Count = 1;\n'),
  },
  // ---- extern aliases ----
  {
    id: 'alias/two-versions',
    references: [
      { file: 'Lib.1.0.0.0.dll', aliases: ['First'] },
      { file: 'Lib.2.0.0.0.dll', aliases: ['Second'] },
    ],
    source:
      'extern alias First;\nextern alias Second;\n' +
      main('    First::Lib.Widget a = new First::Lib.Widget();\n    Second::Lib.Widget b = new Second::Lib.Widget();\n    a.Size = b.Size;\n'),
  },
  {
    id: 'alias/not-in-global',
    references: [{ file: 'Lib.1.0.0.0.dll', aliases: ['First'] }],
    source: main('    Lib.Widget widget = null;\n    object o = widget;\n    o.ToString();\n'),
  },
  {
    id: 'alias/unknown',
    references: [{ file: 'Lib.1.0.0.0.dll', aliases: ['First'] }],
    source: 'extern alias Missing;\n' + main(''),
  },
  {
    id: 'alias/global-and-named',
    references: [{ file: 'Lib.1.0.0.0.dll', aliases: ['global', 'First'] }],
    source: 'extern alias First;\n' + main('    Lib.Widget a = new First::Lib.Widget();\n    a.Size = 1;\n'),
  },
  {
    id: 'alias/different-types-do-not-convert',
    references: [
      { file: 'Lib.1.0.0.0.dll', aliases: ['First'] },
      { file: 'Lib.2.0.0.0.dll', aliases: ['Second'] },
    ],
    source: 'extern alias First;\nextern alias Second;\n' + main('    First::Lib.Widget a = new Second::Lib.Widget();\n    a.Size = 1;\n'),
  },
  // ---- type forwarding ----
  {
    id: 'forward/followed-to-destination',
    references: ['Facade.dll', 'Lib.2.0.0.0.dll', 'FacadeConsumer.dll'],
    source: main('    Client.Shelf shelf = new Client.Shelf();\n    shelf.Size = 1;\n    shelf.First = new Lib.Gadget();\n'),
  },
  {
    id: 'forward/through-the-facade-name',
    references: ['Facade.dll', 'Lib.2.0.0.0.dll'],
    source: main('    Lib.Widget widget = new Lib.Widget();\n    widget.Size = 1;\n    Facade.Marker marker = null;\n    object o = marker;\n'),
  },
  {
    id: 'forward/destination-missing',
    references: ['Facade.dll', 'FacadeConsumer.dll'],
    source: main('    Client.Shelf shelf = new Client.Shelf();\n    shelf.Size = 1;\n'),
  },
  {
    id: 'forward/destination-missing-by-name',
    references: ['Facade.dll'],
    source: main('    Lib.Widget widget = null;\n    object o = widget;\n'),
  },
];
