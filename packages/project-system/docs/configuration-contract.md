# Configuration text contract

`parseConfigurationJson(source, options)` parses configuration JSON without
executing expressions or reading the environment. It accepts a leading BOM,
line and block comments, and trailing commas by default. String contents retain
their original meaning, including comment-like text and escaped characters.

Use `{allowTrailingCommas:false}` for configuration formats that accept comments
but reject trailing commas, including the SDK's `global.json` reader. Invalid
input throws an error with stable code `SFJSON001`, a zero-based UTF-16 `start`
offset, `length`, and one-based `line` and `column` locations. Configurable
`maxLength`, `maxDepth` and `maxNodes` limits default to 1,000,000 UTF-16 code
units, 64 nested containers and 100,000 values.

Object keys are own data properties. A `__proto__` key remains ordinary parsed
data and does not modify an object's prototype. The parser never evaluates
JavaScript or discovers external files.

`getCaseInsensitive(object, name)` reads an own property, preferring an exact
spelling and otherwise comparing names case insensitively. Missing keys return
`undefined`; inherited properties are not read. Project property and metadata
consumers share this spelling rule.

This batch exposes the shared configuration contracts. Native SDK selection and
launch consumers use these APIs in their dependent batches. The portable project
evaluator and its framework-context implementation are separate batches.
