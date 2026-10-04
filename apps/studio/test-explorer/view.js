import {escapeHtml as escape} from '@sharpforge/editor';
import {testProviders} from './controller.js';
import {reportAction, formatBytes} from '../native-build/settings.js';

function markup() {
  return `<div class="tool-page test-explorer"><h2>Test Explorer</h2>
    <label class="tool-field">Test provider<select data-test-provider></select></label>
    <p data-test-project></p><p data-test-boundary></p>
    <div class="tool-actions"><button class="button" data-test-discover>Discover tests</button>
      <button class="button" data-test-run>Run selected</button><button class="button" data-test-cancel>Cancel</button>
      <button class="button" data-test-project-settings>Project context and trust</button></div>
    <div class="native-checks"><label><input type="checkbox" data-test-setting="noBuild"> Use existing native build output</label>
      <label><input type="checkbox" data-test-setting="coverage"> Collect native coverage</label>
      <label><input type="checkbox" data-test-setting="debug"> Wait for native debugger</label></div>
    <label class="tool-field">Test timeout (milliseconds)
      <input type="number" min="1" max="3600000" data-test-setting="timeoutMs"></label>
    <p data-test-status role="status" aria-live="polite"></p><div data-test-diagnostics></div>
    <label class="tool-field">Filter names, classes and traits<input data-test-filter type="search"></label>
    <div class="tool-actions"><button class="button" data-test-select-all>Select all</button>
      <button class="button" data-test-select-none>Clear selection</button></div>
    <div data-test-list></div><div data-test-details></div><div data-test-debugger></div>
    <details><summary>Test host output</summary><pre data-test-output tabindex="0"></pre></details>
    <div data-test-artifacts></div><div data-test-coverage></div></div>`;
}

function bind(controller, element) {
  const act = action => reportAction(controller.host, action);
  element.querySelector('[data-test-provider]').onchange = event => act(() => controller.configure({provider: event.target.value}));
  element.querySelector('[data-test-discover]').onclick = () => act(() => controller.discover());
  element.querySelector('[data-test-run]').onclick = () => act(() => controller.run());
  element.querySelector('[data-test-cancel]').onclick = () => controller.cancel();
  element.querySelector('[data-test-project-settings]').onclick = () => controller.host.onSelectPanel?.('msbuild');
  element.querySelector('[data-test-select-all]').onclick = () => act(() => controller.selectAll(true));
  element.querySelector('[data-test-select-none]').onclick = () => act(() => controller.selectAll(false));
  element.querySelector('[data-test-filter]').oninput = event => { controller.filter = event.target.value; renderTestRows(controller, element); };
  for (const control of element.querySelectorAll('[data-test-setting]')) control.onchange = () => act(() => controller.configure({
    [control.dataset.testSetting]: control.type === 'checkbox' ? control.checked : Number(control.value)
  }));
}

function renderTestRows(controller, element) {
  const query = controller.filter.toLowerCase();
  const filtered = controller.tests.filter(test => (test.fqn + ' ' + test.displayName + ' ' + JSON.stringify(test.traits)).toLowerCase().includes(query));
  const visible = filtered.slice(0, 250);
  const root = element.querySelector('[data-test-list]');
  root.innerHTML = visible.length ? `<table class="data-table"><thead><tr><th>Select</th><th>Test / class</th><th>Outcome</th>
    <th>Duration</th></tr></thead><tbody>${visible.map(test => {
    const result = controller.results.get(test.id);
    return `<tr data-test-id="${escape(test.id)}"><td><input type="checkbox" data-test-check="${escape(test.id)}"
      aria-label="Select ${escape(test.displayName)}" ${controller.selected.has(test.id) ? 'checked' : ''} ${controller.busy ? 'disabled' : ''}></td>
      <td><button class="button" data-test-detail="${escape(test.id)}">${escape(test.displayName)}</button>
      <small> · ${escape(test.className ?? test.fqn.slice(0, test.fqn.lastIndexOf('.')))}</small></td>
      <td>${escape(result?.outcome ?? (test.notRunnableReason ? 'not-runnable' : test.skipReason ? 'skipped' : 'not-run'))}</td>
      <td>${result ? result.durationMs.toFixed(1) + ' ms' : '—'}</td></tr>`;
  }).join('')}</tbody></table>` : '<p>No tests match. Discover tests or change the filter.</p>';
  if (filtered.length > visible.length) root.insertAdjacentHTML('beforeend', '<p>Showing 250 tests; narrow the filter to see more.</p>');
  for (const control of root.querySelectorAll('[data-test-check]')) {
    control.onchange = () => controller.select(control.dataset.testCheck, control.checked);
  }
  for (const button of root.querySelectorAll('[data-test-detail]')) button.onclick = () => {
    controller.focused = button.dataset.testDetail;
    renderTestDetails(controller, element);
  };
}

function renderTestDetails(controller, element) {
  const test = controller.tests.find(test => test.id === controller.focused);
  const root = element.querySelector('[data-test-details]');
  if (!test) { root.replaceChildren(); return; }
  const result = controller.results.get(test.id);
  const source = result?.source ?? test.source;
  root.innerHTML = `<h3>${escape(test.displayName)}</h3><p>${escape(test.framework ?? 'native test framework')}
    ${source ? ' · ' + escape(source.path) + ':' + source.line : ''}</p>
    <button class="button" data-test-source ${source ? '' : 'disabled'}>Open test source</button>
    <dl>${Object.entries(test.traits ?? {}).map(([name, values]) => `<dt>${escape(name)}</dt><dd>${escape(values.join(', '))}</dd>`).join('')}</dl>
    <pre>${escape(result?.message || test.notRunnableReason || test.skipReason || '')}</pre>
    ${result?.stackTrace ? '<pre>' + escape(result.stackTrace) + '</pre>' : ''}
    ${result?.stdout ? '<h4>Standard output</h4><pre>' + escape(result.stdout) + '</pre>' : ''}
    ${result?.stderr ? '<h4>Standard error</h4><pre>' + escape(result.stderr) + '</pre>' : ''}`;
  root.querySelector('[data-test-source]').onclick = () => reportAction(controller.host, () => controller.openSource(test.id));
}

function renderArtifacts(controller, element) {
  const artifacts = controller.result?.artifacts ?? [];
  const root = element.querySelector('[data-test-artifacts]');
  root.innerHTML = artifacts.length ? '<h3>Test artifacts</h3>' + artifacts.slice(0, 500).map((artifact, index) =>
    `<div class="native-artifact"><span>${escape(artifact.path)} · ${formatBytes(artifact.size ?? 0)}</span>
      <button class="button" data-test-artifact="${index}">Save</button></div>`).join('') : '';
  for (const button of root.querySelectorAll('[data-test-artifact]')) {
    button.onclick = () => reportAction(controller.host, () => controller.artifact(artifacts[Number(button.dataset.testArtifact)].path));
  }
}

function renderCoverage(controller, element) {
  const reports = controller.result?.coverage ?? [];
  const root = element.querySelector('[data-test-coverage]');
  const files = reports.flatMap(report => report.files).slice(0, 250);
  root.innerHTML = reports.length ? '<h3>Code coverage</h3>' + reports.map(report =>
    `<p>${report.coveredLines} / ${report.totalLines} covered lines (${escape(report.format)})</p>`).join('') +
    files.map((file, index) => `<details data-test-coverage-file="${index}"><summary>${escape(file.path)} · ${file.lines.length} lines</summary>
      <div></div></details>`).join('') : '';
  for (const detail of root.querySelectorAll('[data-test-coverage-file]')) detail.ontoggle = () => {
    if (!detail.open || detail.querySelector('div').childNodes.length) return;
    const file = files[Number(detail.dataset.testCoverageFile)];
    detail.querySelector('div').innerHTML = '<table class="data-table"><thead><tr><th>Line</th><th>Hits</th><th>Branches</th></tr></thead><tbody>' +
      file.lines.slice(0, 300).map(line => `<tr><td>${line.number}</td><td>${line.hits}</td>
        <td>${line.coveredBranches} / ${line.totalBranches}</td></tr>`).join('') + '</tbody></table>' +
      (file.lines.length > 300 ? '<p>Showing 300 lines. Download the coverage artifact for the complete report.</p>' : '');
  };
}

export function renderTestExplorer(controller, element) {
  if (!element) return;
  if (!element.querySelector('.test-explorer')) { element.innerHTML = markup(); bind(controller, element); }
  const provider = element.querySelector('[data-test-provider]');
  if (!provider.options.length) provider.innerHTML = testProviders.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  provider.value = controller.provider;
  provider.disabled = controller.busy;
  element.querySelector('[data-test-project]').textContent = 'Project: ' + (controller.request().project || 'Select a project');
  element.querySelector('[data-test-boundary]').textContent = controller.native ?
    'Native tests require explicit workspace trust and installed framework packages. VSTest selects all rows of each selected method.' :
    'Portable tests run in an isolated worker using the supported xUnit, NUnit and MSTest API profiles. Unsupported tests report not-runnable.';
  element.querySelector('[data-test-discover]').disabled = controller.busy || controller.host.busy;
  element.querySelector('[data-test-run]').disabled = controller.busy || controller.host.busy || !controller.selected.size;
  element.querySelector('[data-test-cancel]').disabled = !controller.busy;
  for (const control of element.querySelectorAll('[data-test-setting]')) {
    if (control.type === 'checkbox') control.checked = controller.settings[control.dataset.testSetting];
    else control.value = controller.settings[control.dataset.testSetting];
    control.disabled = controller.busy || control.type === 'checkbox' && !controller.native;
  }
  for (const control of element.querySelectorAll('[data-test-select-all], [data-test-select-none]')) control.disabled = controller.busy;
  const counts = new Map();
  for (const result of controller.results.values()) counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
  element.querySelector('[data-test-status]').textContent = (controller.busy ? 'Working · ' : '') + controller.tests.length + ' tests · ' +
    controller.selected.size + ' selected · ' + [...counts].map(([outcome, count]) => count + ' ' + outcome).join(' · ');
  element.querySelector('[data-test-diagnostics]').innerHTML = controller.diagnostics.map(diagnostic =>
    `<p class="notice"><b>${escape(diagnostic.code)}</b> ${escape(diagnostic.message)}</p>`).join('');
  element.querySelector('[data-test-output]').textContent = controller.output;
  const handoff = controller.session?.debuggerHandoff;
  element.querySelector('[data-test-debugger]').textContent = handoff ?
    `Test host PID ${handoff.pid} ${controller.busy ? 'is waiting for' : 'reported a handoff for'} a ${handoff.protocol} debugger adapter.` : '';
  renderTestRows(controller, element);
  renderTestDetails(controller, element);
  renderArtifacts(controller, element);
  renderCoverage(controller, element);
}
