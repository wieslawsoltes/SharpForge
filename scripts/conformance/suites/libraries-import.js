import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { methods } from './shared/csharp.js';
import {
  upstream,
  source,
  saveSuite,
  sha256,
  corpus,
  main,
} from './shared/store.js';
const assertions = new Set([
  'True',
  'False',
  'Null',
  'NotNull',
  'Same',
  'Equal',
  'Throws',
]);
export function adaptFacts(text, provenance, namespace, shim) {
  const cases = [];
  for (const method of methods(text)) {
    const prefix = text.slice(Math.max(0, method.start - 300), method.start);
    const annotation = prefix.slice(
      Math.max(prefix.lastIndexOf('}'), prefix.lastIndexOf(';')) + 1,
    );
    if (!/\[(?:Fact|Theory)\b/.test(annotation)) continue;
    const original = text.slice(method.start, method.end),
      unsupported = [];
    if (
      !/\bvoid\s+\w+\s*\(\s*\)/.test(original) ||
      /\[Theory\b/.test(annotation)
    )
      unsupported.push(
        'Parameterized theory/member data needs explicit argument materialization',
      );
    if (
      /\b(?:AssertExtensions|PlatformDetection|RemoteExecutor|TestHelper|RunOnce|TestCollection|IsEven)\b|\bthis\b/.test(
        original,
      )
    )
      unsupported.push(
        'Upstream helper, fixture state, or platform-specific dependency',
      );
    if (/\[(?:Conditional|ActiveIssue)|Skip\s*=/.test(annotation))
      unsupported.push('Upstream conditional or skipped test');
    const calls = [...original.matchAll(/\bAssert\.(\w+)/g)].map(
      (match) => match[1],
    );
    for (const name of calls)
      if (!assertions.has(name))
        unsupported.push('xunit shim does not implement Assert.' + name);
    if (!calls.length)
      unsupported.push(
        'No directly supported assertion; helper-based assertions require adaptation',
      );
    const body = original.slice(original.indexOf('{') + 1, -1);
    const sourceText = [
      'using System;',
      'using System.Collections;',
      'using System.Collections.Generic;',
      'using System.Linq;',
      'using Xunit;',
      'class SuiteProgram { static int Main() {',
      body,
      'return 0; } }',
      shim.replace(/^using System;$/m, ''),
    ].join('\n');
    cases.push({
      id:
        'library-' +
        sha256(provenance.path + ':' + method.name + ':' + method.start).slice(
          0,
          20,
        ),
      kind: 'library',
      namespace,
      sourceText,
      sourceSHA256: sha256(sourceText),
      originalSource: original,
      provenance: { ...provenance, method: method.name, offset: method.start },
      langVersion: 'preview',
      target: 'exe',
      references: ['pinned net10.0 reference pack', 'local XunitShim.cs'],
      expected: { exitCode: 0 },
      unsupported: [...new Set(unsupported)],
      adaptation:
        'Original method body in standalone Main; no base fixture/helpers imported. ' +
        'Native compilation preflight detects unresolved dependencies; ' +
        'scalar assertions, reference identity and exact exception assertions execute.',
    });
  }
  return cases;
}
export async function importLibraries(directory) {
  const pin = await upstream(directory, 'runtime'),
    shim = await readFile(path.join(corpus, 'libraries/XunitShim.cs'), 'utf8'),
    cases = [];
  const selected = {
    'System.Runtime': [
      'System.Runtime/tests/System.Runtime.Tests/System/BooleanTests.cs',
      'System.Runtime/tests/System.Runtime.Tests/System/Int32Tests.cs',
      'System.Runtime/tests/System.Runtime.Tests/System/CharTests.cs',
    ],
    'System.Collections': [
      'System.Collections/tests/BitArray/BitArray_GetSetTests.cs',
      'System.Collections/tests/BitArray/BitArray_CtorTests.cs',
      'System.Collections/tests/Generic/Stack/Stack.Tests.cs',
    ],
    'System.Linq': [
      'System.Linq/tests/CountTests.cs',
      'System.Linq/tests/ContainsTests.cs',
      'System.Linq/tests/AnyTests.cs',
    ],
  };
  for (const [namespace, paths] of Object.entries(selected))
    for (const relative of paths) {
      const input = await source(
        pin,
        path.join(directory, 'src/libraries', relative),
      );
      cases.push(...adaptFacts(input.text, input.provenance, namespace, shim));
    }
  return saveSuite('libraries', cases);
}
if (main(import.meta.url)) console.log(await importLibraries(process.argv[2]));
