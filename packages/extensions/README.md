# @sharpforge/extensions

Input-cached, host-trusted **JavaScript** source generators and analyzers. This is not Roslyn binary compatibility; .NET analyzer/generator DLLs cannot be loaded here. Callbacks run synchronously and cannot be forcibly interrupted. Register untrusted plugins only behind an independently secured host boundary.

```js
import { ExtensionDriver, BuildInfoGenerator, EmptyCatchAnalyzer } from '@sharpforge/extensions';
const extensions = new ExtensionDriver().registerGenerator(BuildInfoGenerator).registerAnalyzer(EmptyCatchAnalyzer);
// Pass { extensions, extensionOptions: { version: '1.2.3' } } to Workspace.
```

Generators receive immutable source snapshots, additional-file snapshots, options, AbortSignal, addSource and reportDiagnostic. Results are reused for identical inputs. Analyzer diagnostics use actual document offsets/versions. Generated documents are separate, read-only workspace snapshots. Output count/size/diagnostic limits and failure diagnostics are enforced.

## 0.5 built-ins

`JsonSchemaGenerator` accepts `extensionOptions.schemaProperties: true` to emit public get/set auto-properties instead of fields. `ConstantConditionAnalyzer` (SFAN1003) reports literal bool conditions, except idiomatic `while(true)` / `for(;true;)` loops. `TodoCommentAnalyzer` (SFAN1004) reads lexer trivia, not strings, for TODO/FIXME/HACK markers. Severity overrides use the existing `extensionOptions.severities` map.

0.6 schemas accept `constructor:true` for positional constructors and `immutable:true` for getter-only properties plus constructor assignment. `UnreachableStatementAnalyzer` (SFAN1005) detects structurally unreachable statements after terminal local statements; it does not claim general CFG proof. Severity options remain none/hint/info/warning/error.
