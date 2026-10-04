# Native ParameterInfo display

The independent C# fixture records 16 `ParameterInfo.ToString()` values, covering
method arguments and returns, a constructor and index-property arguments. By-ref
parameters retain `&`, while MethodInfo's argument-list `ByRef` convention is not
used. A marshalled return forces an empty-name Param row; ordinary returns omit
that row. Generic and nested argument names exercise the existing formatter.

Capture and local qualification are pending the serial slot. The native test has
no availability skip and requires successful source/image provenance. No method
body from the reflected fixture is executed by the CLR metadata tests.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-display.mjs tests/fixtures/clr-parameter-display/native.json tests/fixtures/clr-parameter-display/Program.cs
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-parameter-display*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-parameter-display.mjs
```
