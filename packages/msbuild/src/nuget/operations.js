import { editProjectItem } from '@sharpforge/project-system';
import { parseNuGetRange } from './versioning.js';

/** Apply lossless project/central version edits, then invoke the real SDK restore. */
export class NuGetPackageService {
  constructor(engine, workspace = engine.workspace) { this.engine = engine; this.workspace = workspace; }
  async change(request) {
    await this.engine.authorize(request);
    const { project, id, version, operation = 'add', centralPath = null } = request;
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id ?? '')) throw new Error('Invalid package ID');
    if (!['add', 'update', 'remove'].includes(operation)) throw new Error('Unknown package operation');
    if (operation !== 'remove') parseNuGetRange(version);
    const source = await this.workspace.read(project), changes = [];
    const metadata = operation === 'remove' ? {} : centralPath ? { Version: null, VersionOverride: null } : { Version: version };
    const edited = editProjectItem(source.text, { itemType: 'PackageReference', identity: id,
      operation: operation === 'remove' ? 'Delete' : 'Include', metadata });
    changes.push({ path: project, text: edited.text, expectedHash: source.hash });
    if (centralPath && operation !== 'remove') {
      const central = await this.workspace.read(centralPath);
      const result = editProjectItem(central.text, { itemType: 'PackageVersion', identity: id, operation: 'Include', metadata: { Version: version } });
      changes.push({ path: centralPath, text: result.text, expectedHash: central.hash });
    }
    const saved = await this.workspace.save(changes);
    const job = await this.engine.start({ project, action: 'restore', trusted: request.trusted, properties: request.properties });
    return { saved, restoreJobId: job.id, undo: edited.undo, atomic: false };
  }
  async consolidate(request) {
    await this.engine.authorize(request);
    if (!Array.isArray(request.projects) || !request.projects.length || request.projects.length > 128) throw new Error('Consolidation project limit exceeded');
    const results = [];
    for (const project of request.projects) results.push(await this.change({ ...request, project, operation: 'update' }));
    return { results, atomic: false };
  }
  async query(request, options = {}) {
    await this.engine.authorize(request);
    await this.workspace.path(request.project);
    const switches = { vulnerable: '--vulnerable', deprecated: '--deprecated', outdated: '--outdated' };
    if (request.kind && !switches[request.kind]) throw new Error('Unknown package query');
    const args = ['list', request.project, 'package', '--format', 'json', '--include-transitive'];
    if (request.kind) args.push(switches[request.kind]);
    const result = await this.engine.runTool({ arguments: args, project: request.project, trusted: request.trusted }, options);
    if (result.exitCode !== 0) throw Object.assign(new Error('Native package query failed: ' + result.stderr), { result });
    const start = result.stdout.indexOf('{');
    if (start < 0) throw new Error('SDK did not return JSON package information');
    const document = JSON.parse(result.stdout.slice(start));
    return { document, backend: 'native', warnings: result.stderr };
  }
}
