import { createProjectContext } from '@sharpforge/msbuild';
import { NativeProjectContexts } from '../../apps/studio/native-build/project-context.js';
import { defaultNativeSettings, nativeBuildRequest } from '../../apps/studio/native-build/settings.js';

/** Direct model fixture: native transport and host callbacks stay explicit; no controller or DOM is loaded. */
export function nativeUiModelFixture() {
  const calls = [];
  const commits = [];
  const files = new Map([
    ['App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk" />'],
    ['App/One.cs', 'class One {}'],
    ['App/Ten.cs', 'class Ten {}']
  ]);
  const contexts = ['net8.0', 'net10.0'].map((framework, index) => createProjectContext({
    project: 'App/App.csproj', configuration: 'Debug', platform: 'AnyCPU', targetFramework: framework,
    backend: 'native', outputKind: 'exe', defines: ['DEBUG'], langVersion: '12.0', nullable: 'enable',
    unsafe: true, checked: true, references: [{ path: '/sdk/Contract.dll', aliases: ['global'] }],
    sources: [{ path: index ? 'App/Ten.cs' : 'App/One.cs', readOnly: false }],
    generatedSources: [{ path: 'App/obj/' + framework + '/GlobalUsings.g.cs', text: 'global using System;',
      generated: true, readOnly: true }],
    properties: { AssemblyName: 'Fixture', Configuration: 'Debug', TargetFramework: framework },
    diagnostics: index ? [{ code: 'FIXTURE_CONTEXT', severity: 'warning', message: 'Selected context diagnostic' }] : []
  }));
  const workspace = {
    root: '/fixture', projects: ['App/App.csproj', 'Other/Other.csproj'],
    files: [...files.keys()].map(path => ({ path }))
  };
  const host = {
    workspace, settings: { ...defaultNativeSettings(), project: 'App/App.csproj', trusted: true },
    buffers: new Map(), profiles: { reset() { calls.push({ kind: 'reset-profiles' }); } },
    request(action) { return nativeBuildRequest(this.settings, action); },
    async attach() { calls.push({ kind: 'attach' }); },
    async operation(label, action, options) {
      calls.push({ kind: 'operation', label, options });
      const controller = new AbortController();
      this.controller = controller;
      try { return await action(controller.signal); }
      finally { if (this.controller === controller) this.controller = null; }
    },
    async onProjectContext(value) { commits.push(value); },
    renderBuild(force) { calls.push({ kind: 'render', force }); }
  };
  host.client = {
    async read(path) {
      calls.push({ kind: 'read', path });
      if (!files.has(path)) throw new Error('No such file: ' + path);
      return { path, text: files.get(path), hash: 'hash:' + path };
    },
    async projectContexts(request) {
      calls.push({ kind: 'contexts', request });
      return contexts;
    },
    async projectMetadata(request) {
      calls.push({ kind: 'metadata', request });
      return {
        contextId: contexts.find(context => context.targetFramework === request.framework).id,
        references: [{ path: '/sdk/Contract.dll', display: 'Contract.dll', aliases: ['global'], base64: 'AQID', size: 3 }],
        totalBytes: 3
      };
    }
  };
  host.contexts = new NativeProjectContexts(host);
  host.contexts.reset(workspace);
  return { host, model: host.contexts, files, contexts, calls, commits, cancel: () => host.controller?.abort() };
}
