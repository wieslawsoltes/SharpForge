import {parsePropertyLines} from '@sharpforge/msbuild';

export const buildActions = Object.freeze([
  ['build', 'Build'], ['rebuild', 'Rebuild'], ['clean', 'Clean'], ['restore', 'Restore'], ['pack', 'Pack'],
  ['publish', 'Publish'], ['test', 'Test (VSTest)'], ['target', 'Run target'], ['evaluate', 'Evaluate'],
  ['targets', 'List targets'], ['preprocess', 'Preprocess']
]);

export function defaultNativeSettings() {
  return {project: '', configuration: 'Debug', platform: '', framework: '', runtime: '', properties: '',
    targets: '', resultTargets: '', arguments: '', verbosity: 'minimal', maxNodes: '1', restore: true,
    binaryLog: false, graphBuild: false, trusted: false, save: true};
}

/** Advanced MSBuild switches remain an argument vector; application arguments have a separate profile field. */
export function nativeBuildRequest(settings, action) {
  const argumentsList = settings.arguments.trim() ? JSON.parse(settings.arguments) : [];
  if (!Array.isArray(argumentsList) || argumentsList.some(value => typeof value !== 'string')) {
    throw new TypeError('Advanced arguments must be a JSON string array');
  }
  const targets = value => value.split(/[;,]/).map(part => part.trim()).filter(Boolean);
  return {action, project: settings.project, configuration: settings.configuration, platform: settings.platform,
    framework: settings.framework, runtime: settings.runtime, properties: parsePropertyLines(settings.properties),
    targets: targets(settings.targets), resultTargets: targets(settings.resultTargets), arguments: argumentsList,
    verbosity: settings.verbosity, maxNodes: Number(settings.maxNodes), restore: settings.restore,
    binaryLog: settings.binaryLog, graphBuild: settings.graphBuild, trusted: settings.trusted};
}

export const terminalBuild = status => ['succeeded', 'failed', 'cancelled'].includes(status);

export function formatBytes(value) {
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KiB';
  return (value / 1048576).toFixed(1) + ' MiB';
}

export function delay(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, {once: true});
  });
}

export function reportAction(host, action) {
  return Promise.resolve().then(action).catch(error => {
    if (error?.name !== 'AbortError') host.onError?.(error);
  });
}

export function downloadNativeArtifact(bytes, path) {
  const url = URL.createObjectURL(new Blob([bytes], {type: 'application/octet-stream'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.replaceAll('\\', '/').split('/').at(-1);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
