import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { methods, constant } from './shared/csharp.js';
import {
  upstream,
  source,
  files,
  saveSuite,
  sha256,
  main,
} from './shared/store.js';

export function extractRoslyn(text, errorCodes, provenance) {
  const cases = [],
    skipped = [];
  for (const method of methods(text)) {
    const items = method.tokens;
    for (let index = 0; index < items.length; index++) {
      if (
        !/^CreateCompilation(?:WithMscorlib\w*)?$/.test(items[index].text) ||
        items[index + 1]?.text !== '('
      )
        continue;
      const end = items[index + 1].close;
      if (end === undefined) continue;
      const identity = {
        ...provenance,
        method: method.name,
        offset: items[index].start,
      };
      try {
        let argEnd = index + 2;
        while (argEnd < end && items[argEnd].text !== ',') argEnd++;
        const sourceText = constant(items, index + 2, argEnd, index);
        let verify = end + 2;
        const variable =
          items[index - 1]?.text === '=' ? items[index - 2]?.text : null;
        if (
          items[end + 1]?.text !== '.' ||
          items[verify]?.text !== 'VerifyDiagnostics'
        ) {
          verify = items.findIndex(
            (token, at) =>
              at > end &&
              token.text === 'VerifyDiagnostics' &&
              items[at - 2]?.text === variable &&
              items[at - 1]?.text === '.',
          );
        }
        if (verify < 0 || items[verify]?.text !== 'VerifyDiagnostics')
          throw Error('No associated VerifyDiagnostics expectation');
        if (
          variable &&
          items
            .slice(end + 1, verify - 2)
            .some(
              (token, at, between) =>
                token.text === variable && between[at + 1]?.text === '=',
            )
        )
          throw Error('Compilation variable reassigned');
        const expectationEnd = items[verify + 1]?.close;
        if (expectationEnd === undefined)
          throw Error('Unresolved diagnostics expression');
        const expectationTokens = items.slice(verify + 2, expectationEnd);
        const expected = [];
        for (let at = verify + 2; at < expectationEnd; ) {
          if (items[at].text !== 'Diagnostic' || items[at + 1]?.text !== '(')
            throw Error('Nonliteral diagnostic argument');
          at = items[at + 1].close + 1;
          while (items[at]?.text === '.' && items[at + 2]?.text === '(')
            at = items[at + 2].close + 1;
          if (at < expectationEnd && items[at++].text !== ',')
            throw Error('Unexpected diagnostic expression');
        }
        for (let at = 0; at < expectationTokens.length; at++) {
          if (expectationTokens[at].text !== 'Diagnostic') continue;
          const tail = expectationTokens
            .slice(at, at + 7)
            .map((token) => token.text)
            .join('');
          const code = /^Diagnostic\(ErrorCode\.(\w+)/.exec(tail)?.[1];
          if (!code || errorCodes[code] === undefined)
            throw Error('Unknown expected diagnostic');
          expected.push({
            code: `CS${String(errorCodes[code]).padStart(4, '0')}`,
            severity: code.startsWith('WRN_') ? 'warning' : 'error',
          });
        }
        if (expectationTokens.length && !expected.length)
          throw Error('Nonliteral diagnostics expectation');
        const call = text.slice(items[index].start, items[end].end);
        const version =
          /(?:TestOptions\.(?:Regular|Script)|LanguageVersion\.CSharp)(\d+(?:_\d+)?)/
            .exec(call)?.[1]
            ?.replace('_', '.');
        const langVersion = /Preview/.test(call)
          ? 'preview'
          : version || (/parseOptions\s*:/.test(call) ? 'default' : 'preview');
        const references = /references\s*:/.test(call)
          ? call.slice(call.indexOf('references'))
          : 'TargetFramework.Standard (pinned Roslyn CSharpTestBase default)';
        const reasons = [];
        if (argEnd < end && items[argEnd + 2]?.text !== ':')
          reasons.push(
            'Positional reference/options arguments require explicit adaptation',
          );
        if (/targetFramework\s*:/.test(call))
          reasons.push(
            'Nondefault upstream target-framework references require adaptation',
          );
        if (
          /parseOptions\s*:/.test(call) &&
          !/parseOptions\s*:\s*TestOptions\.Regular(?:Preview|\d+(?:_\d+)?)?\s*[,)]/.test(
            call,
          )
        )
          reasons.push(
            'Dynamic or customized parse options require adaptation',
          );
        if (/references\s*:|WithMscorlib|WithReferences/.test(call))
          reasons.push(
            'Upstream reference profile differs from SharpForge closed framework; references retained for reference-qualified adaptation',
          );
        if (
          /Script|With[A-Z]|options\s*:\s*(?!TestOptions\.(?:ReleaseDll|DebugDll|ReleaseExe|DebugExe)\b)/.test(
            call,
          )
        )
          reasons.push(
            'Custom upstream compilation/parse options require an adapter',
          );
        cases.push({
          id: 'roslyn-' + sha256(JSON.stringify(identity)).slice(0, 20),
          kind: 'diagnostics',
          sourceText,
          sourceSHA256: sha256(sourceText),
          provenance: identity,
          langVersion,
          target: /(?:Release|Debug)Exe/.test(call) ? 'exe' : 'library',
          references,
          options: call.slice(call.indexOf('(')),
          expected: {
            diagnostics: expected,
            comparison:
              'code and severity multiset; locations/arguments retained as upstream expression',
          },
          expectationText: text.slice(
            items[verify + 1].end,
            items[expectationEnd].start,
          ),
          unsupported: reasons,
        });
      } catch (error) {
        skipped.push({ ...identity, reason: error.message });
      }
    }
  }
  return { cases, skipped };
}
export async function importRoslyn(directory, maximum = 2400) {
  const pin = await upstream(directory, 'roslyn');
  const errors = await readFile(
    path.join(directory, 'src/Compilers/CSharp/Portable/Errors/ErrorCode.cs'),
    'utf8',
  );
  const errorCodes = Object.fromEntries(
    [...errors.matchAll(/\b((?:ERR|WRN)_\w+)\s*=\s*(\d+)/g)].map((match) => [
      match[1],
      Number(match[2]),
    ]),
  );
  const cases = [],
    skipped = [],
    unique = new Set();
  for (const file of await files(
    path.join(directory, 'src/Compilers/CSharp/Test'),
    '.cs',
  )) {
    const input = await source(pin, file);
    let extracted;
    try {
      extracted = extractRoslyn(input.text, errorCodes, input.provenance);
    } catch (error) {
      skipped.push({ path: input.provenance.path, reason: error.message });
      continue;
    }
    skipped.push(...extracted.skipped);
    for (const row of extracted.cases) {
      const key = sha256(
        JSON.stringify([
          row.sourceText,
          row.expected,
          row.langVersion,
          row.options,
        ]),
      );
      if (unique.has(key)) continue;
      unique.add(key);
      cases.push(row);
      if (cases.length === maximum) break;
    }
    if (cases.length === maximum) break;
  }
  if (cases.length < 2000)
    throw Error(
      `Only ${cases.length} actual source/expectation cases extracted; minimum is 2000`,
    );
  return saveSuite('roslyn', cases, skipped);
}
if (main(import.meta.url)) console.log(await importRoslyn(process.argv[2]));
