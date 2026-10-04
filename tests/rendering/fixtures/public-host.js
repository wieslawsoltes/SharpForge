import {createWinUIApp, WinUIHost} from '@sharpforge/winui';

/** Own a real public host and report its actual surface counters; no fixture substitutes a GPU adapter. */
export function beginPublicHost(definition, options, {raw = false} = {}) {
  const {document, container, resources, service, backend, onMetrics, onError} = options;
  const mount = document.createElement('div');
  Object.assign(mount.style, {position: 'relative', width: definition.width + 'px', height: definition.height + 'px',
    overflow: 'hidden', background: definition.background ?? 'transparent'});
  container.append(mount);
  const measured = new Map();
  const hostOptions = {backend, animationManual: true, services: {resources, device: service}, onError,
    onMetrics(value) {
      if (value.id) measured.set(value.id + ':' + (value.layerPolicy ?? value.operation ?? value.backend), value);
      onMetrics(value);
    }};
  const app = raw ? null : createWinUIApp(mount, hostOptions);
  const host = app?.host ?? new WinUIHost(mount, hostOptions);
  const surfaces = () => [...host.sceneRenderer.entries.values(), ...host.sceneRenderer.compositionEntries.values()]
    .map(entry => entry.surface).filter(Boolean);
  const liveMeasurements = () => [...measured.values()].filter(value => {
    if (value.layerPolicy === 'element-composition-child') return !!host.sceneRenderer.compositionEntries.get(value.id)?.surface;
    if (value.layerPolicy === 'element-stacking-context') return !!host.sceneRenderer.entries.get(value.id)?.surface;
    return host.elements.get(value.id)?.isConnected === true;
  });
  const usedBackends = () => [...new Set([...surfaces().map(surface => surface.backend),
    ...liveMeasurements().filter(value => value.backend === 'dom').map(() => 'dom')])];
  const renderFrame = () => {
    host.scheduleRender();
    app ? app.flush() : host.flush();
    for (const surface of surfaces()) surface.draw();
    for (const [key, value] of measured) if (!host.elements.has(value.id)) measured.delete(key);
  };
  return {
    app, host, mount, measured, surfaces, usedBackends, renderFrame,
    width: definition.width, height: definition.height, captureElement: mount,
    actualBackend: () => usedBackends().includes(backend) ? backend : usedBackends()[0] ?? 'dom',
    async settle() {
      await (app ? app.settled() : host.settled());
      await Promise.all(surfaces().map(surface => surface.ready));
      renderFrame();
    },
    metrics() {
      const rows = liveMeasurements().filter(value => value.commands !== undefined);
      const sum = key => rows.length && rows.every(row => Number.isFinite(row[key]))
        ? rows.reduce((total, row) => total + row[key], 0) : null;
      return {drawCalls: sum('drawCalls'), totalGpuBytes: sum('totalGpuBytes'), atlasBytes: sum('atlasBytes'),
        renderTargetBytes: sum('renderTargetBytes'), textureBytes: sum('textureBytes'), bufferBytes: sum('bufferBytes'),
        uploadedBytes: sum('uploadedBytes'), fallbacks: rows.flatMap(row => row.fallbacks ?? []), sampleCount: rows[0]?.sampleCount};
    },
    dispose() {
      app ? app.dispose() : host.dispose();
      mount.remove();
    }
  };
}
