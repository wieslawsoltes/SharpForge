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
  assert.equal(native.scopes.length, symbols.scopes.length);
  assert.equal(native.methods.length, symbols.methods.length);
  assert.equal(native.custom.length, symbols.custom.length);
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

async function roslynFixtures(tool, compilers, references) {
  const source = join(temporary, 'RoslynFixture.cs');
  await cp(join(root, 'packages/symbols/interop/RoslynFixture.cs'), source);
  const versions = new Set();
  for (const [index, compiler] of compilers.entries()) {
    const version = run(dotnet, [compiler.path, '/version']);
    versions.add(version);
    const pePath = join(temporary, 'roslyn-' + index + '.dll');
    const pdbPath = join(temporary, 'roslyn-' + index + '.pdb');
    const response = join(temporary, 'compiler-' + index + '.rsp');
    const args = [
      '/nologo',
      '/target:library',
      '/debug:portable',
      '/deterministic+',
      '/optimize-',
      '/langversion:12',
      '/out:' + pePath,
      '/pdb:' + pdbPath,
      '/embed:' + source,
      '/pathmap:' + temporary + '=/src',
      ...references.map((reference) => '/reference:' + reference),
      source,
    ];
    await writeFile(response, args.map((argument) => '"' + argument + '"').join('\n'));
    run(dotnet, [compiler.path, '@' + response]);
    const pdb = await readFile(pdbPath);
    const assembly = await readFile(pePath);
    const symbols = readPortablePdb(pdb);
    verifyNative(JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, pePath])), symbols, assembly);
    const kinds = [];
    for (const record of symbols.custom) {
      kinds.push(record.kind);
      if ([PdbGuids.embeddedSource, PdbGuids.sourceLink].includes(record.kind)) continue;
      const structured = readCustomDebugInformation(record.kind, record.bytes);
      assert(
        equalBytes(writeCustomDebugInformation(record.kind, structured), record.bytes),
        'CDI mismatch: ' + record.kind,
      );
    }
    const rebound = attachPortablePdb(assembly, pdb, { embedded: true });
    const reboundPath = join(temporary, 'rebound-' + index + '.dll');
    await writeFile(reboundPath, rebound);
    verifyNative(JSON.parse(run(dotnet, [tool, 'inspect', pdbPath, reboundPath])), symbols, rebound);
    results.push({
      name: compiler.name,
      status: 'passed',
      compilerVersion: version,
      compilerSha256: digest(await readFile(compiler.path)),
      pdbSha256: digest(pdb),
      kinds: [...new Set(kinds)].sort(),
    });
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
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
