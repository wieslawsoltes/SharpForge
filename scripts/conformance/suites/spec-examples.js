import path from 'node:path';
import {
  upstream,
  source,
  saveSuite,
  sha256,
  json,
  root,
  main,
} from './shared/store.js';
export function annotations(text) {
  const clean = text.replace(/^> ?/gm, ''),
    output = [];
  for (const match of clean.matchAll(
    /<!-- Example:\s*(\{(?:(?!-->)[\s\S])*?\})\s*-->\s*```csharp\r?\n([\s\S]*?)\r?\n```/g,
  )) {
    const metadata = JSON.parse(
      match[1].replace(/([{,]\s*)([A-Za-z][\w]*):/g, '$1"$2":'),
    );
    output.push({ metadata, sourceText: match[2], offset: match.index });
  }
  return output;
}
export function adaptExample(example) {
  const { metadata, sourceText } = example,
    unsupported = [];
  if (metadata.replaceEllipsis || metadata.additionalFiles || metadata.project)
    unsupported.push(
      'Upstream multi-file/ellipsis/project template requires explicit adaptation',
    );
  if (
    metadata.inferOutput ||
    metadata.expectedException ||
    metadata.executionArgs
  )
    unsupported.push(
      'Runtime expectation requires upstream output/exception/argument extraction',
    );
  let adapted = sourceText;
  if (metadata.template?.startsWith('code-in-main'))
    adapted = `class Program { static void Main() {\n${sourceText}\n} }`;
  else if (metadata.template?.startsWith('code-in-class-lib'))
    adapted = `class Program {\n${sourceText}\n}`;
  else if (!metadata.template?.startsWith('standalone-'))
    unsupported.push('Unsupported upstream template: ' + metadata.template);
  if (!metadata.template?.endsWith('-without-using'))
    adapted = 'using System;\nusing System.Collections.Generic;\n' + adapted;
  const diagnostics = [
    ...(metadata.expectedErrors ?? []).map((code) => ({
      code,
      severity: 'error',
    })),
    ...(metadata.expectedWarnings ?? []).map((code) => ({
      code,
      severity: 'warning',
    })),
  ];
  return {
    sourceText: adapted,
    unsupported,
    target: /console|main/.test(metadata.template) ? 'exe' : 'library',
    expected: {
      diagnostics,
      ignoredWarnings: metadata.ignoredWarnings ?? [],
      ...(metadata.expectedOutput
        ? {
            stdout: metadata.expectedOutput.length
              ? metadata.expectedOutput.join('\n') + '\n'
              : '',
            exitCode: 0,
          }
        : {}),
    },
  };
}
export async function importSpecifications(
  standardDirectory,
  proposalDirectory,
) {
  const standard = await upstream(standardDirectory, 'csharpstandard'),
    proposals = await upstream(proposalDirectory, 'csharplang');
  const inventory = await json(
    path.join(root, 'planning/qualification/inventory/csharp-features.json'),
  );
  const rows = new Map(inventory.rows.map((row) => [row.id, row])),
    cases = [],
    skipped = [];
  const chapters = {
    'classes.md': 'csharp-1-0-classes',
    'structs.md': 'csharp-1-0-structs',
    'enums.md': 'csharp-1-0-enums',
    'interfaces.md': 'csharp-1-0-interfaces',
    'delegates.md': 'csharp-1-0-delegates',
    'expressions.md': 'csharp-1-0-expressions',
    'attributes.md': 'csharp-1-0-attributes',
  };
  for (const [chapter, featureId] of Object.entries(chapters)) {
    if (!rows.has(featureId))
      throw Error('Unmapped inventory feature ' + featureId);
    const input = await source(
      standard,
      path.join(standardDirectory, 'standard', chapter),
    );
    for (const example of annotations(input.text)) {
      const adapted = adaptExample(example),
        identity = input.provenance.path + ':' + example.metadata.name;
      cases.push({
        id: 'standard-' + sha256(identity).slice(0, 20),
        kind: 'spec',
        ...adapted,
        sourceSHA256: sha256(adapted.sourceText),
        originalSource: example.sourceText,
        metadata: example.metadata,
        langVersion: '8.0',
        featureId,
        mappingScope:
          'Standard chapter to inventory feature; language level is pinned draft-v8, not feature introduction version',
        provenance: {
          ...input.provenance,
          example: example.metadata.name,
          offsetInUnquotedMarkdown: example.offset,
        },
      });
    }
  }
  const visited = new Set();
  for (const row of rows.values()) {
    const relative = /\/proposals\/([^#]+\.md)/.exec(row.specSection)?.[1];
    if (!relative || relative.includes('..') || visited.has(relative)) continue;
    visited.add(relative);
    let input;
    try {
      input = await source(
        proposals,
        path.join(proposalDirectory, 'proposals', relative),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      skipped.push({
        featureId: row.id,
        relative,
        reason: 'Inventory proposal absent from pinned archive',
      });
      continue;
    }
    let ordinal = 0;
    for (const match of input.text.matchAll(
      /```(?:csharp|cs|C#)\r?\n([\s\S]*?)\r?\n```/g,
    )) {
      const sourceText = match[1];
      cases.push({
        id: 'proposal-' + sha256(relative + ':' + ordinal++).slice(0, 20),
        kind: 'spec',
        sourceText,
        sourceSHA256: sha256(sourceText),
        target: 'library',
        featureId: row.id,
        langVersion: row.langVersion,
        expected: { referenceDiagnostics: true },
        unsupported: /\.\.\.|…/.test(sourceText)
          ? ['Ellipsis/pseudocode requires annotated completion']
          : [],
        mappingScope:
          'Exact inventory specSection; fenced fragment compiled as library against pinned Roslyn, not assumed valid standalone program',
        provenance: { ...input.provenance, offset: match.index },
      });
    }
  }
  return saveSuite('spec', cases, skipped);
}
if (main(import.meta.url))
  console.log(await importSpecifications(process.argv[2], process.argv[3]));
