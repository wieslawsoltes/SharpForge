import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, token, equalBytes } from '@sharpforge/cil';
import {
  emitPortablePdb,
  readPortablePdb,
  attachPortablePdb,
  loadSymbols,
  PdbGuids,
  guidString,
  readCustomDebugInformation,
  writeCustomDebugInformation,
} from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const outputIndex = process.argv.indexOf('--output');
const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : join(root, 'artifacts/pdb-srm/results.json'));
const captureIndex = process.argv.indexOf('--capture-fixtures');
const capture = captureIndex >= 0 ? resolve(process.argv[captureIndex + 1]) : null;
const captured = [];
const allowSingle = process.argv.includes('--allow-single-compiler');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_ROLL_FORWARD: 'Major' },
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-pdb-srm-'));
const results = [];
const sdk = run(dotnet, ['--version']);

function comparableImports(imports) {
  return imports.map((scope) => ({
    id: scope.id,
    parent: scope.parent,
    definitions: scope.definitions.map((definition) =>
      Object.fromEntries(Object.entries(definition).filter(([, value]) => value !== null)),
    ),
  }));
}

function verifyNative(native, symbols, assembly) {
  assert.equal(native.id.toLowerCase(), symbols.idHex);
  assert.deepEqual(
    native.documents.map((document) => document.name),
    symbols.documents.map((document) => document.name),
  );
  assert.deepEqual(comparableImports(native.imports), symbols.imports);
  assert.deepEqual(
    native.constants.map((constant) => constant.signature.toLowerCase()),
    symbols.constants.map((constant) => Buffer.from(constant.signature).toString('hex')),
  );
  assert.deepEqual(
    native.scopes,
    symbols.scopes.map((scope) => ({
      method: scope.methodToken,
      StartOffset: scope.start,
      Length: scope.end - scope.start,
      importScope: scope.importScope,
      variables: scope.variables.map((variable) => variable.id),
      constants: scope.constants.map((constant) => constant.id),
    })),
  );
  assert.deepEqual(
    native.methods,
    symbols.methods.map((method) => ({
      token: method.token,
      kickoff: symbols.stateMachines.find((state) => state.moveNext === method.token)?.kickoff ?? 0x06000000,
      points: method.points.map((point) => ({
        Offset: point.offset,
        document: point.document,
        StartLine: point.startLine,
        StartColumn: point.startColumn,
        EndLine: point.endLine,
        EndColumn: point.endColumn,
        IsHidden: point.hidden,
      })),
    })),
  );
  assert.deepEqual(
    native.custom.map((record) => ({ ...record, bytes: record.bytes.toLowerCase() })),
    symbols.custom.map((record) => ({
      parent: record.parent,
      kind: record.kind,
      bytes: Buffer.from(record.bytes).toString('hex'),
    })),
  );
  if (assembly) assert.equal(loadSymbols(assembly, symbols.bytes).idHex, symbols.idHex);
  for (const document of native.documents) {
    const expected = symbols.documents[document.id - 1];
    assert.equal(document.hash.toLowerCase(), Buffer.from(expected.hash).toString('hex'));
    assert.equal(document.language, expected.language);
  }
}

function emittedDebug(assembly) {
  const pe = readPE(assembly, { inspection: true });
  const methodToken = token(6, 1);
  return {
    sources: [
      { uri: '/src/shared/first.cs', text: 'public class A {}\n'.repeat(30) },
      { uri: '/src/shared/second.cs', text: 'public class B {}\n'.repeat(30) },
    ],
    importScopes: [
      { definitions: [{ kind: 6, alias: 'external', assembly: 1 }] },
      {
        parent: 1,
        definitions: [
          { kind: 1, namespace: 'System' },
          { kind: 2, assembly: 1, namespace: 'System' },
          { kind: 3, type: token(1, 1) },
          { kind: 4, alias: 'xml', namespace: 'https://example.test' },
          { kind: 5, alias: 'external' },
          { kind: 7, alias: 'Alias', namespace: 'System' },
          { kind: 8, alias: 'Alias2', assembly: 1, namespace: 'System' },
          { kind: 9, alias: 'Object', type: token(1, 1) },
        ],
      },
    ],
    methods: [
      {
        token: methodToken,
        scopes: [
          {
            start: 0,
            end: pe.methodBody(methodToken).code.length,
            importScope: 2,
            constants: [
              { name: 'Answer', type: 'int', value: 42 },
              { name: 'Text', type: 'string', value: '𝄞 hello' },
              { name: 'Maximum', type: 'ulong', value: 0xffffffffffffffffn },
            ],
            locals: [{ slot: 0, name: 'local' }],
          },
        ],
      },
    ],
  };
}

async function readback(tool) {
  const compiled = compileToIL('int value=1; Console.WriteLine(value);', { portablePdb: false });
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const debug = emittedDebug(compiled.assembly);
  const emitted = emitPortablePdb(compiled.assembly, debug);
  const pdbPath = join(temporary, 'emitted.pdb');
  await writeFile(pdbPath, emitted.bytes);
  for (const algorithm of ['SHA256', 'SHA384', 'SHA512']) {
    const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, { embedded: true, checksum: algorithm });
    const pePath = join(temporary, 'emitted-' + algorithm + '.dll');
    await writeFile(pePath, assembly);
    const native = JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, pePath]));
    verifyNative(native, readPortablePdb(emitted.bytes), assembly);
    assert.deepEqual(
      native.constants.map((constant) => [constant.name, constant.value]),
      [
        ['Answer', '42'],
        ['Text', '𝄞 hello'],
        ['Maximum', '18446744073709551615'],
      ],
    );
    assert.deepEqual(
      native.directories.map((entry) => entry.kind),
      [2, 19, 16, 17],
    );
    const codeView = native.directories.find((entry) => entry.kind === 2);
    assert.equal(codeView.guid, guidString(emitted.id.subarray(0, 16)));
    assert.equal(codeView.Age, 1);
    assert.equal(
      native.directories.find((entry) => entry.kind === 17).id.toLowerCase(),
      Buffer.from(emitted.id).toString('hex'),
    );
    results.push({
      name: 'SRM reads emitted ' + algorithm + ' symbols',
      status: 'passed',
      pdbSha256: digest(emitted.bytes),
    });
  }
  const names = debug.sources.map((source) => ({
    uri: source.uri,
    language: PdbGuids.csharp,
    hashAlgorithm: PdbGuids.sha256,
    hash: createHash('sha256').update(source.text).digest('hex'),
  }));
  const nameInput = join(temporary, 'documents.json');
  const nameOutput = join(temporary, 'documents.pdb');
  await writeFile(nameInput, JSON.stringify(names));
  run(dotnet, [tool, 'documents', nameInput, nameOutput]);
  const reference = readPortablePdb(await readFile(nameOutput));
  const actual = readPortablePdb(
    emitPortablePdb(compiled.assembly, { sources: debug.sources }, { embedSources: false }).bytes,
  );
  assert.deepEqual(
    actual.metadata.rows[48].map((row) => [...actual.metadata.blob(row[0])]),
    reference.metadata.rows[48].map((row) => [...reference.metadata.blob(row[0])]),
  );
  results.push({ name: 'SRM document name byte identity', status: 'passed' });
}

async function compileFixture(compiler, language, references, fixtureName, sourceLink) {
  const source = join(temporary, 'RoslynFixture.' + language);
  const sourceText = await readFile(join(root, 'packages/symbols/interop/RoslynFixture.' + language), 'utf8');
  await writeFile(source, sourceText.replaceAll('\r\n', '\n'));
  const compilerPath = language === 'cs' ? compiler.path : join(dirname(compiler.path), 'vbc.dll');
  const pePath = join(temporary, fixtureName + '.dll');
  const pdbPath = join(temporary, fixtureName + '.pdb');
  const response = join(temporary, fixtureName + '.rsp');
  const args = [
    '/nologo',
    '/target:library',
    '/debug:portable',
    '/deterministic+',
    '/optimize-',
    ...(language === 'cs'
      ? ['/langversion:12']
      : ['/rootnamespace:RootSymbols', '/nostdlib', '/vbruntime*', '/define:_MYTYPE=\"Empty\"']),
    '/sourcelink:' + sourceLink,
    '/out:' + pePath,
    ...(language === 'cs' ? ['/pdb:' + pdbPath] : []),
    '/embed:' + source,
    '/pathmap:' + temporary + '=/src',
    ...references.map((reference) => '/reference:' + reference),
    source,
  ];
  await writeFile(response, args.map((argument) => '"' + argument.replaceAll('"', '\\"') + '"').join('\n'));
  run(dotnet, [compilerPath, '@' + response]);
  return { source, compilerPath, pePath, pdbPath };
}

async function verifyFixture(tool, compiler, language, paths, fixtureName) {
  const { source, compilerPath, pePath, pdbPath } = paths;
  const version = run(dotnet, [compilerPath, '/version']);
  const pdb = await readFile(pdbPath);
  const assembly = await readFile(pePath);
  const symbols = readPortablePdb(pdb);
  verifyNative(JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, pePath])), symbols, assembly);
  const kinds = [];
  const records = [];
  for (const record of symbols.custom) {
    kinds.push(record.kind);
    if (record.kind === PdbGuids.embeddedSource) continue;
    const structured = readCustomDebugInformation(record.kind, record.bytes);
    records.push({ kind: record.kind, parent: record.parent, bytes: Buffer.from(record.bytes).toString('hex') });
    assert(
      equalBytes(writeCustomDebugInformation(record.kind, structured), record.bytes),
      'CDI mismatch: ' + record.kind,
    );
  }
  assert(kinds.includes(PdbGuids.sourceLink), 'Source Link fixture missing');
  assert(kinds.includes(PdbGuids.typeDocuments), 'Declaration-only type document fixture missing');
  if (language === 'vb') {
    assert.equal(symbols.custom.find((record) => record.kind === PdbGuids.defaultNamespace)?.namespace, 'RootSymbols');
  }
  captured.push({
    compiler: compiler.name,
    version,
    language,
    compilerSha256: digest(await readFile(compilerPath)),
    pdbSha256: digest(pdb),
    sourceSha256: digest(await readFile(source)),
    records,
  });
  const rebound = attachPortablePdb(assembly, pdb, { embedded: true });
  const reboundPath = join(temporary, fixtureName + '-rebound.dll');
  await writeFile(reboundPath, rebound);
  verifyNative(JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, reboundPath])), symbols, rebound);
  if (language === 'cs') await verifyStateWriter(tool, assembly, symbols, fixtureName);
  results.push({
    name: compiler.name + ' ' + language,
    status: 'passed',
    compilerVersion: version,
    compilerSha256: digest(await readFile(compilerPath)),
    pdbSha256: digest(pdb),
    kinds: [...new Set(kinds)].sort(),
  });
  return version;
}

async function verifyStateWriter(tool, assembly, symbols, fixtureName) {
  assert(symbols.stateMachines.length >= 2, 'Expected async and iterator pairs');
  const emitted = emitPortablePdb(assembly, {
    stateMachines: symbols.stateMachines,
    custom: [{ parent: token(0, 1), kind: PdbGuids.sourceLink, sourceLink: symbols.sourceLink }],
  });
  const pdbPath = join(temporary, fixtureName + '-state-writer.pdb');
  const pePath = join(temporary, fixtureName + '-state-writer.dll');
  const rebound = attachPortablePdb(assembly, emitted.bytes);
  await writeFile(pdbPath, emitted.bytes);
  await writeFile(pePath, rebound);
  const written = readPortablePdb(emitted.bytes);
  assert.deepEqual(written.stateMachines, symbols.stateMachines);
  verifyNative(JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, pePath])), written, rebound);
}

async function roslynFixtures(tool, compilers, references) {
  const sourceLink = join(temporary, 'source-link.json');
  await writeFile(sourceLink, JSON.stringify({ documents: { '/src/*': 'https://example.test/source/*' } }));
  const versions = new Set();
  for (const [index, compiler] of compilers.entries()) {
    for (const language of ['cs', 'vb']) {
      const fixtureName = 'roslyn-' + index + '-' + language;
      const paths = await compileFixture(compiler, language, references, fixtureName, sourceLink);
      versions.add(await verifyFixture(tool, compiler, language, paths, fixtureName));
    }
  }
  if (!allowSingle)
    assert(versions.size >= 2, 'Full interoperability gate requires at least two distinct Roslyn compiler versions');
  return [...versions];
}

try {
  const sdkListing = run(dotnet, ['--list-sdks'])
    .split('\n')
    .find((line) => line.startsWith(sdk + ' '));
  assert(sdkListing, 'Active SDK not present in --list-sdks');
  const sdkRoot = sdkListing.match(/\[(.*)\]/)[1];
  const dotnetRoot = dirname(sdkRoot);
  const packs = join(dotnetRoot, 'packs/Microsoft.NETCore.App.Ref');
  const packVersion = (await readdir(packs))
    .filter((name) => name.startsWith('10.'))
    .sort()
    .at(-1);
  assert(packVersion, '.NET 10 reference pack required');
  const referenceRoot = join(packs, packVersion, 'ref/net10.0');
  const references = (await readdir(referenceRoot))
    .filter((name) => name.endsWith('.dll'))
    .sort()
    .map((name) => join(referenceRoot, name));
  const project = join(temporary, 'SrmReader');
  await cp(join(root, 'packages/symbols/interop/SrmReader'), project, { recursive: true });
  await writeFile(
    join(temporary, 'NuGet.Config'),
    '<configuration><packageSources><clear /></packageSources></configuration>',
  );
  run(dotnet, [
    'build',
    join(project, 'SrmReader.csproj'),
    '-o',
    join(temporary, 'tool'),
    '--disable-build-servers',
    '-m:1',
    '-p:UseSharedCompilation=false',
    '--nologo',
    '--configfile',
    join(temporary, 'NuGet.Config'),
  ]);
  const tool = join(temporary, 'tool/SrmReader.dll');
  await readback(tool);
  const compilers = [
    { name: 'Installed SDK Roslyn', path: join(sdkRoot, sdk, 'Roslyn/bincore/csc.dll') },
    ...JSON.parse(process.env.SF_PDB_COMPILERS ?? '[]'),
  ];
  const versions = await roslynFixtures(tool, compilers, references);
  const report = {
    schemaVersion: 1,
    sdk,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    complete: versions.length >= 2,
    compilerVersions: versions,
    results,
  };
  if (capture) {
    await mkdir(dirname(capture), { recursive: true });
    await writeFile(capture, JSON.stringify({ schemaVersion: 1, sdk, fixtures: captured }, null, 2) + '\n');
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
