import path from 'node:path';
import {
  upstream,
  source,
  files,
  saveSuite,
  sha256,
  main,
} from './shared/store.js';
export function opcodeFamilies(text) {
  const families = new Set();
  const rules = {
    arithmetic: /\b(add|sub|mul|div|rem|neg|and|or|xor|shl|shr)(\.|\s)/,
    branches: /\b(br|brtrue|brfalse|beq|bne|blt|bgt|ble|bge|switch)(\.|\s)/,
    memory:
      /\b(ldind|stind|ldobj|stobj|cpobj|initobj|localloc|cpblk|initblk)(\.|\s)/,
    objects:
      /\b(newobj|castclass|isinst|box|unbox|ldfld|stfld|ldsfld|stsfld)(\.|\s)/,
    arrays: /\b(newarr|ldelem|stelem|ldlen|ldelema)(\.|\s)/,
    calls: /\b(call|callvirt|calli|ret)(\.|\s)/,
    exceptions: /\b(throw|rethrow|leave|endfinally|endfilter)(\.|\s)/,
    conversions: /\b(conv|ckfinite)(\.|\s)/,
  };
  for (const [family, regex] of Object.entries(rules))
    if (regex.test(text)) families.add(family);
  return [...families].sort();
}
export function adaptRuntime(text, extension) {
  const unsupported = [];
  if (extension === '.il') {
    if (!/\.entrypoint\b/.test(text))
      unsupported.push('No standalone IL entry point');
    if (/\.include\b|ASSEMBLY_NAME|legacy library/.test(text))
      unsupported.push(
        'Upstream IL preprocessor/legacy assembly rewrite required',
      );
    return {
      sourceText: text,
      unsupported,
      language: 'il',
      opcodeFamilies: opcodeFamilies(text),
    };
  }
  if (
    /\b(?:TestLibrary|TestFramework|PlatformDetection|Helpers)\b|\[Conditional/.test(
      text,
    )
  )
    unsupported.push(
      'External runtime test harness or conditional platform dependency',
    );
  const entries = [
    ...text.matchAll(
      /\b(?:public\s+)?static\s+int\s+(TestEntryPoint|Main)\s*\(/g,
    ),
  ];
  if (entries.length !== 1)
    unsupported.push('Requires exactly one static int test entry point');
  const sourceText = text
    .replace(/using\s+Xunit\s*;/g, '')
    .replace(/\[(?:Fact|OuterLoop)(?:\([^\]]*\))?\]/g, '')
    .replace(/\bTestEntryPoint\s*\(/g, 'Main(');
  return { sourceText, language: 'csharp', unsupported, opcodeFamilies: [] };
}
export async function importRuntime(directory) {
  const pin = await upstream(directory, 'runtime'),
    cases = [];
  const groups = [
    ['src/tests/JIT/IL_Conformance/Old/Base', '.il', 24],
    ['src/tests/JIT/Directed/Convert', '.il', 12],
    ['src/tests/JIT/Methodical/cctor/simple', '.cs', 18],
    ['src/tests/JIT/Methodical/Boxing', '.cs', 18],
    ['src/tests/JIT/Directed/Arrays', '.cs', 18],
  ];
  for (const [relative, extension, limit] of groups) {
    let paths;
    try {
      paths = await files(path.join(directory, relative), extension);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of paths.slice(0, limit)) {
      const input = await source(pin, file),
        adapted = adaptRuntime(input.text, extension);
      cases.push({
        id: 'runtime-' + sha256(input.provenance.path).slice(0, 20),
        kind: 'runtime',
        ...adapted,
        sourceSHA256: sha256(adapted.sourceText),
        originalSource: input.text,
        provenance: input.provenance,
        namespace: 'JIT',
        langVersion: 'preview',
        target: 'exe',
        references: ['pinned net10.0 reference pack'],
        expected: { exitCode: 100 },
        adaptation:
          extension === '.cs'
            ? 'Remove Fact/OuterLoop discovery attributes and Xunit using; rename TestEntryPoint to Main. Test body unchanged.'
            : 'Unmodified upstream IL. Native ILAsm required; no IL simulation.',
      });
    }
  }
  return saveSuite('runtime-il', cases);
}
if (main(import.meta.url)) console.log(await importRuntime(process.argv[2]));
