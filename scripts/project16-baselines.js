import { readFile, stat } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateEditorReport } from './check-editor-perf.js';
import { validateWorkbenchTrace } from '../tests/workbench-perf-budget.mjs';

const maximumBaselineBytes = 32 * 1024 * 1024;
const known = value => typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'unknown';
const operatingSystems = new Map([['windows', 'win32'], ['windows_nt', 'win32'], ['macos', 'darwin']]);
const architectures = new Map([['amd64', 'x64'], ['x86_64', 'x64'], ['aarch64', 'arm64'], ['i386', 'ia32'], ['i686', 'ia32']]);
const operatingSystem = value => operatingSystems.get(value.toLowerCase().split(' ')[0]) ?? value.toLowerCase().split(' ')[0];
const architecture = value => architectures.get(value.toLowerCase()) ?? value.toLowerCase();

/** Capture only facts available before a benchmark/browser starts; browser version is intentionally absent. */
export function qualificationEnvironment() {
  return { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' };
}

function repositoryFile(root, value) {
  if (!value) return null;
  const path = resolve(root, value);
  const subpath = relative(root, path);
  if (!subpath || isAbsolute(subpath) || subpath === '..' || subpath.startsWith('../') || subpath.startsWith('..\\')) {
    throw new Error('A performance baseline must be a file inside the checkout');
  }
  return path;
}

function match(label, previous, current, normalize = value => value) {
  if (known(previous) && known(current) && normalize(previous) !== normalize(current)) {
    throw new Error(`Performance baseline environment mismatch (${label}): '${previous}' versus '${current}'`);
  }
}

function editorEnvironment(report, engine, host) {
  const environment = report.environment;
  if (!report.rows.every(row => row.backend === 'browser-' + engine)) {
    throw new Error('Editor baseline must contain only measurements from browser-' + engine);
  }
  match('editor browser', environment.browser, engine);
  match('editor OS', environment.platform, host.platform, operatingSystem);
  match('editor architecture', environment.arch, host.arch, architecture);
  match('editor Node', environment.node, host.node);
  match('editor CPU', environment.cpu, host.cpu);
}

function workbenchEnvironment(report, engine, host) {
  const environment = report.environment;
  match('workbench browser', environment.engine, engine);
  match('workbench OS', environment.operatingSystem, host.platform, operatingSystem);
  match('workbench architecture', environment.architecture, host.arch, architecture);
  // These fields are optional in the workbench schema. Python's processor description has different semantics from a Node CPU model.
  match('workbench Node', environment.node, host.node);
  match('workbench CPU', environment.cpu, host.cpu);
  match('workbench processor', environment.processor, host.processor);
}

async function load(path, validate, read, inspect) {
  if (!path) return null;
  const information = await inspect(path);
  if (!information.isFile() || information.size > maximumBaselineBytes) {
    throw new Error('Performance baseline must be a file of at most 32 MiB: ' + path);
  }
  const text = await read(path, 'utf8');
  if (Buffer.byteLength(text) > maximumBaselineBytes) throw new Error('Performance baseline grew beyond 32 MiB: ' + path);
  const report = JSON.parse(text);
  validate(report);
  return { path, report };
}

/** Validate both supplied baselines before any capture, preserving empty inputs as capture-only mode. */
export async function loadPerformanceBaselines({ root, editorPath, workbenchPath, engine,
  host = qualificationEnvironment(), read = readFile, inspect = stat }) {
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unsupported qualification browser');
  const paths = [repositoryFile(root, editorPath), repositoryFile(root, workbenchPath)];
  const [editor, workbench] = await Promise.all([
    load(paths[0], validateEditorReport, read, inspect), load(paths[1], validateWorkbenchTrace, read, inspect)
  ]);
  if (editor) editorEnvironment(editor.report, engine, host);
  if (workbench) workbenchEnvironment(workbench.report, engine, host);
  return { editor, workbench };
}
