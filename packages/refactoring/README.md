# @sharpforge/refactoring

Conservative bound-symbol rename (when supplied a LanguageService), var/explicit-type rewrites, whitespace-only indentation, lexical brace folding and AST selection ranges. Versioned multi-document changes validate all spans/overlaps before mutation and recompile a candidate workspace before changing a previously successful project. Type rename and arbitrary extract-method transformations are not supported.

```js
const engine = new RefactoringEngine(workspace, language);
const actions = engine.actions('Program.cs', cursorOffset);
engine.apply(actions[0]); // rejects stale edits and newly introduced compile errors
```

The 0.6 structural actions include make-constant for immutable primitive literal locals, terminal if/else to conditional return, simple methods to expression bodies (excluding constructors), and using to a scope-preserving using declaration. Actions decline unsupported shapes or destructive comment rewrites and compile the candidate before application.
