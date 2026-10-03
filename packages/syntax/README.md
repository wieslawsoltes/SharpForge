# @sharpforge/syntax

Source-preserving tokenization and error-recovering parsing of the SharpForge C# subset.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/syntax';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.13 interpolation

The lexer/parser accept regular and verbatim interpolated string tokens with expression spans, escaped braces, alignment and format components. Nested expressions retain absolute UTF-16 coordinates. Raw interpolated strings and custom handler protocols remain unsupported.

## Lossless syntax tree

The parser builds an immutable, lossless tree named after Roslyn's `SyntaxKind` members. Every character of the input
- whitespace, comments, directives, disabled text, and tokens skipped during error recovery - is kept, so
`tree.toFullString()` always equals the source.

```js
import { SyntaxTree, SyntaxWalker, SyntaxWalkerDepth, parse } from '@sharpforge/syntax';
const tree = SyntaxTree.parseText('class C { int x; }', { languageVersion: '12', preprocessorSymbols: ['DEBUG'] });
tree.root.members[0].identifier.text;            // 'C' - red nodes with typed accessors, parent links and spans
tree.root.findToken(10).parent.kind;             // token lookup by position
tree.getDiagnostics();                           // lexical, syntax and feature-availability diagnostics
const next = tree.withChangedText([{ start: 14, length: 1, text: 'y' }]);   // unchanged members are reused by identity
const legacy = parse('class C { int x; }');      // the plain AST consumed by the compiler; legacy.syntax is the red root
```

- `green.js` / `red.js`: green nodes, tokens with leading and trailing trivia, and the positioned red facade.
- `grammar/syntax.json` drives `generated/nodes.js` (`node packages/syntax/tools/generate-nodes.js`): accessors, `with*()` updaters and `SyntaxFactory`.
- `lexer/`, `directives/`: typed numeric literals, raw and UTF-8 strings, structured interpolations, the preprocessor.
- `parser/`: one module per declaration, expression and pattern family; `legacy-adapter.js` converts the red tree to the plain AST.
- `features.js`, `langversion.js`, `feature-gate.js`: the C# 1-14 (+ preview) feature catalog and LangVersion gating.
- `visitor.js`: `SyntaxVisitor`, `SyntaxWalker` and `SyntaxRewriter`.

Reference data under `test/` is dumped from Roslyn with `node packages/syntax/tools/update-reference.js` (requires the .NET SDK);
the tests compare node kinds, spans, trivia, token values and error codes against those dumps.
