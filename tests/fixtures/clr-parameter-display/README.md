# Native ParameterInfo display

The independent C# fixture records 16 `ParameterInfo.ToString()` values, covering
method arguments and returns, a constructor and index-property arguments. By-ref
parameters retain `&`, while MethodInfo's argument-list `ByRef` convention is not
used. A marshalled return forces an empty-name Param row; ordinary returns omit
that row. Generic and nested argument names exercise the existing formatter.

SDK 10.0.201/CoreCLR 10.0.5 captured all 16 values; all 24 affected tests pass
without skips, including mandatory successful source/image provenance. No method
body from the reflected fixture is executed by the CLR metadata tests. Detailed
checks, exact-parent controls and all raw samples are in `packages/clr/PARAMETERS.md`.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-display.mjs tests/fixtures/clr-parameter-display/native.json tests/fixtures/clr-parameter-display/Program.cs
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-parameter-display*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-parameter-display.mjs
```
