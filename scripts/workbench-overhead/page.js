/** These functions run in the real production page through Playwright's CSP-safe evaluate API. */
export function initializeCapture() {
  const capture = {samples: [], violations: [], verified: {documentSwitches: 0, commands: 0,
    insertedCharacters: 0, trustedInputs: 0, coldTools: 0}};
  Object.defineProperty(window, '__sfInstrumentationCapture', {value: capture, configurable: true});
  window.addEventListener('securitypolicyviolation', event => capture.violations.push({
    directive: event.effectiveDirective, blockedURI: event.blockedURI
  }));
}

export function captureStartup(enabled) {
  const capture = window.__sfInstrumentationCapture;
  const shell = window.sharpforge.workbenchShell;
  if (shell.metrics.enabled !== enabled || shell.settings.get('environment', 'performanceTracing') !== enabled) {
    throw new Error('Startup tracing preference was not applied');
  }
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!navigation || navigation.domContentLoadedEventEnd <= 0) throw new Error('Missing browser navigation timing');
  capture.samples.push({operation: 'startup', ordinal: 0, durationMs: navigation.domContentLoadedEventEnd - navigation.startTime});
  capture.navigation = navigation.toJSON();
  capture.browser = {userAgent: navigator.userAgent, platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null,
    deviceScaleFactor: devicePixelRatio, timeOrigin: performance.timeOrigin};
}

export async function prepareWorkspace({records, sourceFiles}) {
  const loaded = await window.sharpforge.loadDiskRecords(records, {name: 'InstrumentationOverhead', entry: 'Overhead.csproj'});
  const shell = window.sharpforge.workbenchShell;
  if (!loaded || shell.documents.list().filter(file => file.uri.endsWith('.cs')).length !== sourceFiles) {
    throw new Error('Instrumentation fixture workspace did not load');
  }
  if (shell.services.builds.list().some(build => build.busy)) throw new Error('Fixture workspace build remains busy');
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
}

export async function measureDocuments(protocol) {
  const shell = window.sharpforge.workbenchShell, capture = window.__sfInstrumentationCapture;
  for (let ordinal = 0; ordinal < protocol.documentSwitches; ordinal++) {
    const uri = `Types/Type${ordinal % (protocol.sourceFiles - 1)}.cs`;
    const start = performance.now();
    await shell.navigate({uri});
    const durationMs = performance.now() - start;
    if (shell.context().uri !== uri) throw new Error('Document navigation did not finish');
    capture.samples.push({operation: 'document-switch', ordinal, durationMs, uri});
    capture.verified.documentSwitches++;
    // Settling is outside the timed operation and is never added to the budget denominator.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }
}

export async function measureTools(protocol) {
  const shell = window.sharpforge.workbenchShell, capture = window.__sfInstrumentationCapture;
  for (const [ordinal, tool] of protocol.tools.entries()) {
    if (shell.mounts.has(tool)) throw new Error(`Expected a cold lazy tool: ${tool}`);
    const start = performance.now();
    await shell.activateTool(tool);
    const durationMs = performance.now() - start;
    if (!shell.mounts.has(tool) || !shell.isToolVisible(tool)) throw new Error(`Tool did not activate: ${tool}`);
    capture.samples.push({operation: 'tool-activation', ordinal, durationMs, tool});
    capture.verified.coldTools++;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }
}

export async function measureCommands(protocol) {
  const shell = window.sharpforge.workbenchShell, capture = window.__sfInstrumentationCapture;
  const editor = shell.options.getEditor();
  editor.focus();
  editor.setSelections([{anchor: 0, active: 0}]);
  if (shell.bookmarks.items.length) throw new Error('Expected independent empty bookmark state');
  for (let ordinal = 0; ordinal < protocol.commands; ordinal++) {
    const start = performance.now();
    await shell.execute(protocol.command);
    const durationMs = performance.now() - start;
    if (shell.bookmarks.items.length !== (ordinal + 1) % 2) throw new Error('Registered bookmark command did not execute');
    capture.samples.push({operation: 'command', ordinal, durationMs});
    capture.verified.commands++;
  }
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
}

export function beginInputCapture(protocol) {
  const capture = window.__sfInstrumentationCapture, shell = window.sharpforge.workbenchShell;
  const editor = shell.options.getEditor(), originalLength = editor.model.length;
  editor.setSelections([{anchor: originalLength, active: originalLength}]);
  editor.focus();
  let pending;
  const start = event => {
    if (event.key !== protocol.key || !event.isTrusted || event.target !== editor.input) return;
    if (pending !== undefined) throw new Error('Overlapping input dispatch');
    pending = performance.now();
  };
  const finish = event => {
    if (event.inputType !== 'insertText' || event.data !== protocol.key || event.target !== editor.input) return;
    if (!event.isTrusted || pending === undefined) throw new Error('Unpaired trusted input');
    const durationMs = performance.now() - pending;
    pending = undefined;
    capture.samples.push({operation: 'trusted-key-input', ordinal: capture.verified.trustedInputs++, durationMs});
  };
  window.addEventListener('keydown', start, {capture: true});
  window.addEventListener('beforeinput', finish);
  capture.finishInputs = () => {
    window.removeEventListener('keydown', start, {capture: true});
    window.removeEventListener('beforeinput', finish);
    capture.verified.insertedCharacters = editor.model.length - originalLength;
    if (pending !== undefined || capture.verified.trustedInputs !== protocol.inputs
      || capture.verified.insertedCharacters !== protocol.inputs
      || editor.model.getText(originalLength) !== protocol.key.repeat(protocol.inputs)) throw new Error('Incomplete editor input workload');
  };
}

export function captureResult() {
  const capture = window.__sfInstrumentationCapture, shell = window.sharpforge?.workbenchShell;
  if (!capture) return {};
  return {samples: capture.samples, verified: capture.verified, navigation: capture.navigation,
    browser: capture.browser, violations: capture.violations, observedEnabled: shell?.metrics.enabled,
    trace: shell ? JSON.parse(shell.metrics.export()) : null};
}
