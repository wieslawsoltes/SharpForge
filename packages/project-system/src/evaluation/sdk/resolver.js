import { splitList, fail } from '../errors.js';
import { microsoftNetSdk, netSdkProps, netSdkTargets, netSdkDefaultItems, defaultProperty } from './microsoft-net-sdk.js';

function markedSdk(name, marker, properties = {}) {
  return {
    name,
    props(context) {
      for (const [key, value] of Object.entries(properties)) defaultProperty(context, key, value);
      netSdkProps(context);
      defaultProperty(context, marker, true);
    },
    targets: netSdkTargets,
    items: netSdkDefaultItems,
  };
}

const bundled = new Map([
  ['microsoft.net.sdk', microsoftNetSdk],
  ['microsoft.net.sdk.web', markedSdk('Microsoft.NET.Sdk.Web', 'UsingMicrosoftNETSdkWeb', { OutputType: 'Exe' })],
  ['microsoft.net.sdk.worker', markedSdk('Microsoft.NET.Sdk.Worker', 'UsingMicrosoftNETSdkWorker', { OutputType: 'Exe' })],
  ['microsoft.net.sdk.razor', markedSdk('Microsoft.NET.Sdk.Razor', 'UsingMicrosoftNETSdkRazor')],
  ['mstest.sdk', markedSdk('MSTest.Sdk', 'IsTestProject', { IsTestingPlatformApplication: true, OutputType: 'Exe' })],
  ['microsoft.build.notargets', { name: 'Microsoft.Build.NoTargets', props: context => defaultProperty(context, 'EnableDefaultItems', false) }],
  ['microsoft.build.traversal', { name: 'Microsoft.Build.Traversal', props: context => defaultProperty(context, 'EnableDefaultItems', false) }],
]);

/** Resolve SDK identities through caller-provided resolvers, followed by bundled data-only SDK models. */
export function resolveSdk(reference, context) {
  const [name, inlineVersion] = String(reference.name).split('/');
  const request = { name, version: reference.version ?? inlineVersion ?? '', minimumVersion: reference.minimumVersion ?? '', projectPath: context.path };
  for (const resolver of context.system.options?.sdkResolvers ?? []) {
    const resolved = typeof resolver === 'function' ? resolver(request) : resolver.resolve(request);
    if (resolved?.then) fail('SDK resolvers must be synchronous; prefetch SDK data before evaluation.', 'SFP1004');
    if (resolved) return { ...resolved, name: resolved.name ?? name, requestedVersion: request.version };
  }
  const model = bundled.get(name.toLowerCase());
  if (!model) fail(`SDK '${name}' is not registered in the portable evaluator.`, 'SFP1004');
  return { ...model, requestedVersion: request.version, modelVersion: 'portable-1' };
}

export function projectSdkReferences(root) {
  const values = splitList(root.attributes.Sdk).map(name => ({ name }));
  for (const child of root.children) if (child.name === 'Sdk') values.push({
    name: child.attributes.Name ?? '', version: child.attributes.Version, minimumVersion: child.attributes.MinimumVersion,
  });
  return values;
}

export function applySdkPhase(context, model, phase) {
  const key = model.name.toLowerCase() + '/' + phase;
  if (context.sdkImports.includes(key)) return;
  context.sdkImports.push(key);
  if (!context.sdkModels.some(entry => entry.name.toLowerCase() === model.name.toLowerCase())) context.sdkModels.push(model);
  model[phase]?.(context);
}
