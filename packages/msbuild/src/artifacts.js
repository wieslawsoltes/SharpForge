import { fileURLToPath } from 'node:url';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { parseEvaluationOutput } from './contract.js';
import { parseSarif } from './sarif.js';

const artifactKinds = Object.freeze({
  'output.log': 'log', 'expanded.xml': 'preprocessed', 'targets.txt': 'targets', 'build.binlog': 'binlog', 'diagnostics.sarif': 'sarif'
});

export async function collectJobArtifacts(workspace, job, { output, projectPath }) {
  await writeFile(join(job.directory, 'output.log'), output, { mode: 0o600 });
  if (job.status === 'succeeded' && (job.request.action === 'evaluate' || job.request.resultTargets.length || job.request.designTime)) {
    job.result = parseEvaluationOutput(output);
  }
  for (const [name, kind] of Object.entries(artifactKinds)) {
    const file = join(job.directory, name);
    let info;
    try { info = await lstat(file); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isFile() || info.isSymbolicLink()) continue;
    if (info.size > workspace.maxArtifactBytes) {
      job.artifacts.push({ path: workspace.relative(file), size: info.size, kind, downloadable: false, reason: 'artifact-size-limit' });
      continue;
    }
    job.artifacts.push({ path: workspace.relative(file), size: info.size, kind });
    if (['expanded.xml', 'targets.txt'].includes(name) && info.size <= 2 * 1024 * 1024) {
      job.result = { ...job.result, [name === 'targets.txt' ? 'targetsText' : 'preprocessedText']: await readFile(file, 'utf8') };
    }
    if (name === 'diagnostics.sarif') {
      for (const diagnostic of parseSarif(await readFile(file, 'utf8'), { project: job.request.project })) {
        if (diagnostic.file) {
          const path = diagnostic.file.startsWith('file:') ? fileURLToPath(diagnostic.file) : diagnostic.file;
          diagnostic.workspacePath = workspace.relative(isAbsolute(path) ? path : resolve(dirname(projectPath), path));
        }
        const existing = job.diagnostics.find(item => item.code === diagnostic.code && item.line === diagnostic.line &&
          item.column === diagnostic.column && item.workspacePath === diagnostic.workspacePath);
        if (existing) Object.assign(existing, diagnostic); else job.diagnostics.push(diagnostic);
      }
    }
  }
  if (job.status === 'succeeded' && !['evaluate', 'preprocess', 'targets'].includes(job.request.action) && !job.request.designTime) {
    const projects = /\.slnx?$/i.test(job.request.project) ? (await workspace.scan()).projects : [job.request.project];
    const paths = new Set(job.artifacts.map(artifact => artifact.path));
    for (const project of projects) {
      for (const file of await workspace.outputs(project)) {
        if (job.artifacts.length >= 2048) break;
        if (!paths.has(file.path)) { paths.add(file.path); job.artifacts.push({ ...file, kind: 'output' }); }
      }
    }
  }
  const targets = Object.values(job.result?.TargetResults ?? {}).flatMap(result => (result.Items ?? []).map(item => item.FullPath ?? item.Identity));
  for (const value of [job.result?.Properties?.TargetPath, ...targets].filter(path => typeof path === 'string').slice(0, 512)) {
    const file = isAbsolute(value) ? value : resolve(dirname(projectPath), value), relative = workspace.relative(file);
    if (!relative || job.artifacts.some(artifact => artifact.path === relative)) continue;
    try {
      const info = await lstat(await workspace.path(relative));
      if (info.isFile() && info.size <= workspace.maxArtifactBytes) {
        job.artifacts.push({ path: relative, size: info.size, modified: info.mtime.toISOString(), kind: 'evaluated-output' });
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !/Symbolic links|reserved/.test(error.message)) throw error;
    }
  }
}
