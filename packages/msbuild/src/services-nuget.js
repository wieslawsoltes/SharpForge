import { dirname, join } from 'node:path';
import { NuGetPackageService } from './nuget/operations.js';
import { readNuGetConfiguration } from './nuget/config-node.js';
import { readProjectAssets } from './nuget/assets.js';
import { readPackagesLock, lockedRestoreRequest } from './nuget/lock-file.js';
import { NuGetV3Client } from './nuget/v3-client.js';

/** Register package operations while keeping feed credentials on the native host. */
export function registerNativeNuGetServices(registry, { engine, workspace }, options = {}) {
  const nuget = new NuGetPackageService(engine);
  registry.register('nuget', 'configuration', async request => readNuGetConfiguration(
    request.project ? dirname(await workspace.path(request.project)) : workspace.root, { inheritedFiles: options.nugetConfigFiles ?? [] }));
  registry.register('nuget', 'assets', async request => {
    const project = await workspace.path(request.project), relative = workspace.relative(join(dirname(project), 'obj/project.assets.json'));
    return readProjectAssets((await workspace.read(relative)).text);
  });
  registry.register('nuget', 'lock', async request => {
    const project = await workspace.path(request.project), relative = workspace.relative(join(dirname(project), 'packages.lock.json'));
    return readPackagesLock((await workspace.read(relative)).text).document;
  });
  registry.register('nuget', 'restore', request => engine.start(lockedRestoreRequest(request, { locked: request.locked !== false })));
  registry.register('nuget', 'change', request => nuget.change(request));
  registry.register('nuget', 'consolidate', request => nuget.consolidate(request));
  registry.register('nuget', 'query', (request, options) => nuget.query(request, options));
  const feeds = new Map();
  async function feed(request) {
    const configuration = await registry.invoke('nuget', 'configuration', request);
    const source = configuration.sources.find(item => item.name === request.source && item.enabled);
    if (!source) throw new Error('Choose an enabled configured NuGet source');
    if (source.url.includes('%5Bredacted%5D') || source.url.includes('[redacted]')) {
      throw new Error('Credential-bearing feed URLs require a host credential provider');
    }
    if (!feeds.has(source.url)) feeds.set(source.url, new NuGetV3Client(source.url, {
      hostSide: true, credentials: options.nugetCredentials ? url => options.nugetCredentials(source.name, url) : null,
      allowedOrigins: options.nugetOrigins ?? [], fetch: options.fetch
    }));
    return feeds.get(source.url);
  }
  registry.register('nuget', 'search', async (request, options) => (await feed(request)).search(request.query ?? '', { ...request, ...options }));
  registry.register('nuget', 'versions', async (request, options) => (await feed(request)).versions(request.id, options));
  registry.register('nuget', 'registration', async (request, options) => (await feed(request)).registration(request.id, options));
  registry.register('nuget', 'nuspec', async (request, options) => ({ text: await (await feed(request)).nuspec(request.id, request.version, options) }));
  registry.register('nuget', 'vulnerabilities', async (request, options) => (await feed(request)).vulnerabilities(options));
}
