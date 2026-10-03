import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {isMain} from '../../planning/test-manifests.js';
import {git} from '../../planning/lib/io.js';
import {fixtures, fixtureDigest} from './gc/fixtures.js';
import {traceFixture} from './gc/js-collector.js';
import {compareTraces} from './gc/compare.js';
export function recordJSTrace({seed = 1, commit, platform = `${process.platform}-${process.arch}`} = {}) {
  const rows = fixtures(seed), fixtureSHA256 = fixtureDigest(rows);
  return {schemaVersion: 1, collector: {engine: 'js', version: `ManagedHeap/node@${process.versions.node}`}, commit, platform,
    seed, fixtureSHA256, traces: rows.map(traceFixture)};
}
export async function runGCTrace({root = process.cwd(), seed = 1, rustTrace, output = 'artifacts/gc-trace/report.json'} = {}) {
  root = resolve(root);
  const report = {schemaVersion: 1, status: 'running', qualification: 'unknown', errors: []};
  try {
    const commit = git(['rev-parse', 'HEAD'], root).trim(), rows = fixtures(seed), js = recordJSTrace({seed, commit});
    report.js = js;
    if (rustTrace) {
      const rust = JSON.parse(await readFile(resolve(root, rustTrace), 'utf8'));
      report.rust = rust; report.comparison = compareTraces(js, rust, {seed, fixtures: rows, fixtureSHA256: js.fixtureSHA256});
      report.status = report.comparison.status;
    } else {
      report.rust = {status: 'unsupported', reason: 'No Rust collector adapter is implemented or supplied; no Rust trace is synthesized.'};
      report.status = 'unsupported';
      report.comparison = {status: 'unsupported', reachableSets: 'unknown', differences: [], unsupported: [{axis: 'rust-collector', reason: report.rust.reason},
        {axis: 'finalization-order', reason: 'The JS collector has no finalizer queue.'}]};
    }
  } catch (error) { report.status = 'failed'; report.errors.push(error.message); }
  const path = resolve(root, output); await mkdir(dirname(path), {recursive: true}); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options: {root: {type: 'string', default: '.'}, seed: {type: 'string', default: '1'}, 'rust-trace': {type: 'string'}, output: {type: 'string'}, 'require-parity': {type: 'boolean'}}});
  const report = await runGCTrace({...values, seed: Number(values.seed), rustTrace: values['rust-trace']});
  console.log(JSON.stringify({status: report.status, errors: report.errors}));
  if (['failed', 'different'].includes(report.status) || values['require-parity'] && report.status !== 'matched') process.exitCode = 1;
}
