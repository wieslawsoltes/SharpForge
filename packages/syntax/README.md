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
