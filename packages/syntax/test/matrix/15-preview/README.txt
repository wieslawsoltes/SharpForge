C# 15 preview fixtures (provisional grammar)

Each directory holds one preview feature of the catalog (packages/syntax/src/features.js, version 15):

  positive.cs   parses without diagnostics under LangVersion preview
  rejected.cs   the same text; LangVersion 14 reports CS8652 at the offset and span named in its first line

The first line of positive.cs is its revision stamp:

  // preview: <csharplang proposal path> revision <n> commit <first 12 digits of the csharplang commit>

It must equal the stamp in packages/syntax/src/preview-revisions.js. Preview grammar follows public csharplang
proposals that can still change, so the stamp pins the proposal file, the csharplang commit the grammar and the
example were read from, and the revision of the SharpForge grammar written against it. When a proposal moves:

  1. re-read the proposal at the new commit and update the parser module that implements it;
  2. bump `revision` (and `commit`) in preview-revisions.js;
  3. review every fixture of that feature against the new proposal text and rewrite its stamp line.

tests/syntax-preview.test.js fails while a fixture's stamp differs from preview-revisions.js, so a stamp cannot
change without the fixtures being touched.

Examples are taken from the proposal texts where they have one:
  Unions          csharp-15.0/unions.md, "Union declarations / Syntax":  public union Pet(Cat, Dog, Bird);
  ClosedClasses   csharp-15.0/closed-hierarchies.md, "Syntax"
  ClosedEnums     closed-enums.md, "Summary":  public closed enum Color { Red, Green, Blue }
  SafeModifier, UnsafeExpressions   unsafe-evolution.md, "Syntax" and "unsafe expressions"
  ExtensionIndexers   csharp-15.0/extension-indexers.md, "Declaration / Grammar"

A positive.cs.json next to a fixture is a Roslyn reference tree; it exists only where the pinned Roslyn build
parses the feature (stamp.roslyn is true). For the others no Roslyn tree exists yet and the node kinds
(UnionDeclaration, UnionCaseTypeList, UnsafeExpression, and the ClosedKeyword, UnionKeyword and SafeKeyword
tokens) are SharpForge's own names.
