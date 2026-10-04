import {escapeHtml as escape} from '@sharpforge/editor';
import {buildActions, formatBytes, terminalBuild, reportAction} from './settings.js';
import {nativeContextMarkup, bindNativeContextView, updateNativeContextControls} from './context-view.js';

function field(settings, name, label) {
  return `<label class="tool-field">${label}<input data-native-setting="${name}" value="${escape(settings[name])}" maxlength="256"></label>`;
}

function checkboxes(settings) {
  return [['restore', 'Restore before build'], ['save', 'Save before operation'],
    ['binaryLog', 'Capture binary log (may contain secrets)'], ['graphBuild', 'Graph build']].map(([name, label]) =>
    `<label><input type="checkbox" data-native-setting="${name}" ${settings[name] ? 'checked' : ''}> ${label}</label>`).join('');
}

function connectionMarkup(host) {
  if (!host.capabilities) return `<div class="notice">Start the local host, then open its printed URL.</div>
    <pre class="native-command">node packages/msbuild/bin/sharpforge-msbuild.js serve \\
  --root /path/to/workspace --studio dist --trust-projects</pre>
    <p>The SDK and required workloads must be installed locally. The session token remains in memory.</p>`;
  const capabilities = host.capabilities;
  return `<div class="notice ${capabilities.available ? '' : 'warning'}">
    <b>${escape(capabilities.available ? capabilities.version : 'SDK unavailable')}</b><br>${escape(host.workspace?.root ?? '')}
    ${capabilities.error ? '<br>' + escape(capabilities.error) : ''}</div>`;
}

function advancedMarkup(settings) {
  return `<details><summary>Properties, targets and advanced switches</summary>
    <label class="tool-field">Global properties — one Name=Value per line
      <textarea data-native-setting="properties" rows="4" spellcheck="false">${escape(settings.properties)}</textarea></label>
    <label class="tool-field">Custom targets, separated by semicolons
      <input data-native-setting="targets" value="${escape(settings.targets)}"></label>
    <label class="tool-field">Target results to query (also executes these targets)
      <input data-native-setting="resultTargets" value="${escape(settings.resultTargets)}"></label>
    <label class="tool-field">Extra MSBuild switches — JSON array
      <textarea data-native-setting="arguments" rows="2" spellcheck="false" placeholder='["-warnAsError"]'>
        ${escape(settings.arguments)}</textarea></label>
    <div class="native-form-grid"><label class="tool-field">Verbosity<select data-native-setting="verbosity">
      ${['quiet', 'minimal', 'normal', 'detailed', 'diagnostic'].map(value =>
    `<option ${value === settings.verbosity ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
    <label class="tool-field">Parallel nodes
      <input type="number" min="1" max="64" data-native-setting="maxNodes" value="${escape(settings.maxNodes)}"></label></div></details>`;
}

function buildMarkup(host) {
  const settings = host.settings;
  const paths = [...(host.workspace?.solutions ?? []), ...(host.workspace?.projects ?? [])];
  return `<div class="tool-page msbuild-tool">
    <div class="native-heading"><h2>MSBuild</h2><span class="native-engine-badge">LOCAL SDK ENGINE</span></div>
    <p class="native-summary">Build native projects and solutions with the installed SDK.</p>${connectionMarkup(host)}
    <div class="tool-actions"><button class="button" data-command="nativeBuildLayout">Build layout</button>
      <button class="button" data-native-connect>Reconnect / refresh</button>
      <button class="button" data-native-attach ${host.workspace ? '' : 'disabled'}>Use native workspace</button>
      <button class="button" data-native-save ${host.workspace ? '' : 'disabled'}>Save all native files</button></div>
    <label class="tool-field">Project / solution<select data-native-setting="project">${paths.map(path =>
    `<option value="${escape(path)}" ${settings.project === path ? 'selected' : ''}>${escape(path)}</option>`).join('')}</select></label>
    <div class="native-form-grid">${field(settings, 'configuration', 'Configuration')}${field(settings, 'platform', 'Platform (blank = default)')}
      ${field(settings, 'framework', 'Target framework (blank = all)')}${field(settings, 'runtime', 'Runtime identifier (optional)')}</div>
    ${advancedMarkup(settings)}<div class="native-checks">${checkboxes(settings)}</div>
    <label class="native-trust"><input type="checkbox" data-native-setting="trusted" ${settings.trusted ? 'checked' : ''}>
      I trust this workspace. Builds, restore, imports and evaluation may execute local code with my OS permissions.</label>
    <div class="tool-actions native-build-actions">${buildActions.map(([action, label]) =>
    `<button class="button" data-native-action="${action}">${label}</button>`).join('')}
      <button class="button" data-native-cancel>Cancel</button></div>
    <p class="native-operation-status" role="status"></p><details><summary>Actual invocation</summary><pre class="native-invocation"></pre></details>
    <pre class="native-build-output" aria-label="Native MSBuild output" tabindex="0"></pre>
    <div class="native-diagnostics"></div><div class="native-artifacts"></div>${nativeContextMarkup(host)}</div>`;
}

function bindBuild(host, element) {
  for (const control of element.querySelectorAll('[data-native-setting]')) {
    control.addEventListener('input', () => {
      host.settings[control.dataset.nativeSetting] = control.type === 'checkbox' ? control.checked : control.value;
    });
  }
  const act = action => reportAction(host, action);
  for (const button of element.querySelectorAll('[data-native-action]')) {
    button.onclick = () => act(() => host.run(button.dataset.nativeAction));
  }
  element.querySelector('[data-native-cancel]').onclick = () => act(() => host.cancel());
  element.querySelector('[data-native-connect]').onclick = () => act(() => host.client ? host.refresh() : host.connect());
  element.querySelector('[data-native-attach]').onclick = () => act(() => host.attach());
  element.querySelector('[data-native-save]').onclick = () => act(() => host.save());
  bindNativeContextView(host, element);
}

function renderDiagnostics(host, element) {
  const diagnostics = host.job?.diagnostics ?? [];
  const root = element.querySelector('.native-diagnostics');
  root.innerHTML = diagnostics.length ? '<h3>Build diagnostics</h3>' + diagnostics.map((diagnostic, index) =>
    `<button class="native-diagnostic ${escape(diagnostic.severity)}" data-native-diagnostic="${index}">
      <b>${escape(diagnostic.severity)} ${escape(diagnostic.code)}</b> ${escape(diagnostic.file ?? diagnostic.project ?? 'MSBuild')}
      ${diagnostic.line ? ':' + diagnostic.line + ':' + diagnostic.column : ''}<br>${escape(diagnostic.message)}</button>`).join('') : '';
  for (const button of root.querySelectorAll('[data-native-diagnostic]')) {
    button.onclick = () => {
      const diagnostic = diagnostics[Number(button.dataset.nativeDiagnostic)];
      if (diagnostic.workspacePath) reportAction(host, () => host.open(diagnostic.workspacePath, diagnostic.line, diagnostic.column));
    };
  }
}

function renderArtifacts(host, element) {
  const artifacts = host.job?.artifacts ?? [];
  const root = element.querySelector('.native-artifacts');
  root.innerHTML = artifacts.length ? '<h3>Logs and workspace outputs</h3>' +
    '<p>Output discovery includes existing bin files. Building does not imply browser CLR compatibility.</p>' + artifacts.map((artifact, index) =>
    `<div class="native-artifact"><span>${escape(artifact.path)}<small>${formatBytes(artifact.size)}
      ${artifact.modified ? ' · ' + escape(artifact.modified) : ''}</small></span>
      <button class="button" data-native-download="${index}">Save</button>${/\.(dll|exe)$/i.test(artifact.path) ?
    `<button class="button" data-native-inspect="${index}">Inspect IL</button>` : ''}</div>`).join('') : '';
  for (const inspect of [false, true]) {
    const name = inspect ? 'nativeInspect' : 'nativeDownload';
    for (const button of root.querySelectorAll(inspect ? '[data-native-inspect]' : '[data-native-download]')) {
      button.onclick = () => reportAction(host, () => host.artifact(artifacts[Number(button.dataset[name])], {inspect}));
    }
  }
}

export function renderNativeBuild(host, force = false) {
  const element = host.hosts.get('msbuild');
  if (!element) return;
  if (force || !element.querySelector('.msbuild-tool')) {
    element.innerHTML = buildMarkup(host);
    bindBuild(host, element);
  }
  for (const button of element.querySelectorAll('[data-native-action]')) button.disabled = host.busy || !host.capabilities?.available;
  for (const control of element.querySelectorAll('[data-native-setting]')) control.disabled = host.busy;
  for (const selector of ['[data-native-attach]', '[data-native-save]', '[data-native-connect]']) {
    element.querySelector(selector).disabled = host.busy || selector !== '[data-native-connect]' && !host.workspace;
  }
  element.querySelector('[data-native-cancel]').disabled = !host.busy && (!host.job || terminalBuild(host.job.status));
  const job = host.job;
  element.querySelector('.native-operation-status').textContent = host.operationStatus || (job ?
    `${job.request.action.toUpperCase()} · ${job.status}${job.exitCode !== null ? ' · exit ' + job.exitCode : ''}` :
    host.attached ? 'Native workspace active. No operation has run.' : 'No native operation has run.');
  element.querySelector('.native-invocation').textContent = job ? JSON.stringify(job.invocation, null, 2) : '';
  const output = element.querySelector('.native-build-output');
  const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  output.textContent = host.log;
  if (follow) output.scrollTop = output.scrollHeight;
  renderDiagnostics(host, element);
  renderArtifacts(host, element);
  updateNativeContextControls(host, element);
}
