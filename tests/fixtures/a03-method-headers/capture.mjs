import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { analyzeMaxStack, readPE, readMethodHeader } from '@sharpforge/cil';
import { pin, root, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { boundaries, nativeSource, productBoundaries } from './input.js';
import { createProcessRecorder } from './process-capture.mjs';

const output = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass a NEW explicit capture directory; all inputs, assemblies and process observations are retained');
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // An existing directory must never overwrite earlier or failed qualification.
const fixture = fileURLToPath(new URL('./', import.meta.url));
const capture = { schemaVersion: 1, commands: [], observations: {}, sourceSHA256: {}, qualified: false,
  startedAt: new Date().toISOString(), argv: [process.execPath, ...process.argv.slice(1)], cwd: process.cwd() };
const save = () => writeFile(path.join(output, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
const recordProcess = createProcessRecorder({ output, commands: capture.commands, save });
async function run(executable, args) {
  const result = await recordProcess(executable, args, { cwd: output, timeoutMs: 60000 });
  assert.equal(result.signal, null);
  assert.equal(result.exitCode, 0, `${executable}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function effectResolver(observed, method) {
  return instruction => {
    const signature = observed.signatures[instruction.name === 'ret' ? method.token : instruction.operand];
    if (!signature) return null;
    if (instruction.name === 'ret') return { pops: signature.returnsVoid ? 0 : 1, pushes: 0 };
    const instance = signature.hasThis && !signature.explicitThis ? 1 : 0;
    return { pops: signature.parameters + (instruction.name === 'newobj' ? 0 : instance) + (instruction.name === 'calli' ? 1 : 0),
      pushes: instruction.name === 'newobj' || !signature.returnsVoid ? 1 : 0 };
  };
}

async function observe(id, assembly, toolchain, observer) {
  const bytes = await readFile(assembly);
  const observed = JSON.parse(await run(toolchain.dotnet, ['--fx-version', pin.runtime, observer, assembly]));
  const results = [];
  capture.observations[id] = { assembly, assemblySHA256: sha256(bytes), bytes: bytes.length, observed, results };
  await save();
  const pe = readPE(bytes, { inspection: true });
  for (const method of observed.methods) {
    const handlers = method.handlers.map(({ filterOffset, catchType, ...handler }) => ({ ...handler,
      ...(handler.flags === 1 ? { filterOffset } : handler.flags === 0 ? { catchType } : {}),
    }));
    const analysis = analyzeMaxStack(Buffer.from(method.codeHex, 'hex'), { handlers, resolveStackEffect: effectResolver(observed, method) });
    const header = readMethodHeader(pe, method.token);
    results.push({ token: method.token, name: method.name, analysis });
    for (const field of ['headerSize', 'maxStack', 'localSignature', 'initLocals']) assert.equal(header[field], method[field], `${id}.${method.name}.${field}`);
    if (method.name.startsWith('Invalid')) {
      assert.equal(analysis.status, 'invalid', `${id}.${method.name}`);
      assert.equal(observed.executions['Cases::' + method.name].error, 'System.InvalidProgramException');
    } else {
      assert.equal(analysis.status, 'complete', JSON.stringify({ id, method: method.name, analysis }));
      assert.equal(method.maxStack, method.headerSize === 1 ? 8 : analysis.maxStack, `${id}.${method.name} exact fat bound`);
      assert.ok(analysis.maxStack <= method.maxStack);
    }
  }
  await save();
  assert.equal(observed.loadError, null);
  return observed;
}

try {
  for (const name of ['Program.cs', 'corpus.cs', 'capture.mjs', 'input.js', 'process-capture.mjs']) {
    const bytes = await readFile(path.join(fixture, name));
    capture.sourceSHA256[name] = sha256(bytes);
    await writeFile(path.join(output, name), bytes, { flag: 'wx' });
  }
  await save();
  const toolchain = await resolveToolchain({ processRunner: recordProcess });
  capture.toolchain = toolchain.actual;
  capture.environment = toolchain.environment;
  capture.environmentVariables = Object.fromEntries(['SHARPFORGE_ORACLE_DOTNET', 'SHARPFORGE_ILASM', 'DOTNET_ROOT']
    .map(name => [name, process.env[name] ?? null]));
  const ilasm = process.env.SHARPFORGE_ILASM;
  assert.ok(ilasm, 'Set SHARPFORGE_ILASM to the externally provisioned pinned assembler');
  const pins = JSON.parse(await readFile(path.join(root, 'planning/qualification/suites/ilasm-pins.json')));
  const rid = `${{ darwin: 'osx', win32: 'win' }[process.platform] ?? process.platform}-${process.arch}`;
  const assembler = pins.platforms.find(item => item.rid === rid);
  assert.ok(assembler, `No ILAsm pin for ${rid}`);
  assert.equal(pins.version, pin.runtime);
  assert.equal(sha256(await readFile(ilasm)), assembler.sha256);
  capture.assembler = { executable: ilasm, ...assembler };
  const common = [toolchain.csc, '-nologo', '-noconfig', '-nostdlib+', '-warn:0', '-deterministic+', '-unsafe+',
    '-optimize+', '-langversion:latest', ...toolchain.references.map(reference => '-r:' + reference)];
  const observer = path.join(output, 'Observer.dll');
  await run(toolchain.dotnet, [...common, '-target:exe', '-out:' + observer, path.join(output, 'Program.cs')]);
  await writeFile(path.join(output, 'Observer.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
    tfm: pin.targetFramework, framework: { name: 'Microsoft.NETCore.App', version: pin.runtime },
  } }));
  const roslyn = path.join(output, 'Roslyn.dll');
  await run(toolchain.dotnet, [...common, '-target:library', '-out:' + roslyn, path.join(output, 'corpus.cs')]);
  const source = await readFile(path.join(output, 'corpus.cs'), 'utf8');
  const compiled = compileToAssembly(source, { name: 'SharpForge', outputKind: 'library', allowUnsafe: true });
  capture.compiler = { success: compiled.success, diagnostics: compiled.diagnostics };
  await save();
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const product = path.join(output, 'SharpForge.dll');
  await writeFile(product, compiled.assembly);
  const expected = await observe('roslyn', roslyn, toolchain, observer);
  const actual = await observe('compiler', product, toolchain, observer);
  assert.deepEqual(actual.executions, expected.executions);
  for (const execution of Object.values(actual.executions)) assert.equal(execution.error, null);
  const ilSource = nativeSource();
  await writeFile(path.join(output, 'boundaries.il'), ilSource);
  capture.sourceSHA256['boundaries.il'] = sha256(ilSource);
  const native = path.join(output, 'NativeBoundaries.dll');
  const prefix = process.platform === 'win32' ? '/' : '-';
  await run(ilasm, [`${prefix}dll`, `${prefix}output:${native}`, path.join(output, 'boundaries.il')]);
  const productBoundaryPath = path.join(output, 'ProductBoundaries.dll');
  await writeFile(productBoundaryPath, productBoundaries());
  const nativeBoundaries = await observe('ilasm', native, toolchain, observer);
  const emittedBoundaries = await observe('body-writer', productBoundaryPath, toolchain, observer);
  for (const item of boundaries) {
    const left = nativeBoundaries.methods.find(method => method.name === item.name);
    const right = emittedBoundaries.methods.find(method => method.name === item.name);
    for (const method of [left, right]) {
      assert.equal(method.headerSize, item.headerSize, item.name);
      assert.equal(method.codeHex.length / 2, item.size, item.name);
    }
    assert.equal(right.codeHex, left.codeHex);
    assert.deepEqual(emittedBoundaries.executions['Cases::' + item.name], nativeBoundaries.executions['Cases::' + item.name]);
  }
  capture.qualified = true;
  await save();
  console.log(JSON.stringify({ qualified: true, observations: Object.keys(capture.observations) }));
} catch (error) {
  capture.failure = { name: error.name, message: error.message, stack: error.stack, result: error.result ?? null };
  if (error.actualToolchain) capture.actualToolchain = error.actualToolchain;
  await save();
  throw error;
} finally {
  capture.finishedAt = new Date().toISOString();
  await save();
}
