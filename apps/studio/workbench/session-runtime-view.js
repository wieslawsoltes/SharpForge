const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function options(values, selected) {
  return values.map(([value, label]) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`).join('');
}

function targetSection(provider) {
  if (!provider.targets) return '';
  const targets = provider.targets().map(target => [target.id, target.label]);
  return `<section><label class="tool-field">Settings target
    <select id="runtime-target">${options(targets, provider.context().id)}</select></label>
    <p>Profile changes apply to its next launch. Application changes apply to that application's next restart.</p></section>`;
}

function languageSection(settings, project) {
  const versions = ['8', '9', '10', '11', '12', '13', '14', 'preview'].map(version => [
    version, version === 'preview' ? 'Preview — selected C# 15 features' : `C# ${version}`
  ]);
  const description = project ? 'This workspace reads LangVersion from each csproj. Edit the project XML to change it.'
    : 'Feature gates select syntax additions; they do not imply complete compatibility with that language version.';
  return `<section><h3>C# language features</h3><label class="tool-field">Loose-source language version
    <select id="runtime-language" ${project ? 'disabled' : ''}>${options(versions, settings.langVersion)}</select></label>
    <p>${description}</p></section>`;
}

function computeSection(settings) {
  const backends = [['auto', 'Automatic SIMD / scalar fallback'], ['wasm', 'Require WebAssembly SIMD128'], ['scalar', 'Scalar JavaScript']];
  return `<section><h3>SIMD & numerical workers</h3><div class="runtime-grid"><label class="tool-field">Numerical backend
    <select id="runtime-backend">${options(backends, settings.compute.backend)}</select></label>
    <label class="tool-field">Isolated compute workers
      <input id="runtime-workers" type="number" min="1" max="8" value="${settings.compute.workers}"></label></div>
    <p>Vector&lt;int&gt; and Vector&lt;double&gt; use the selected backend. ParallelMath jobs use real workers with copied input buffers.
      Managed Task/Thread contexts remain cooperative; no shared managed heap is exposed to workers.</p></section>`;
}

function networkSection(settings) {
  return `<section><h3>Networking permissions</h3><label class="runtime-grant">
    <input id="runtime-network" type="checkbox" ${settings.enabled ? 'checked' : ''}> Enable networking for this settings target</label>
    <label class="tool-field">Allowed origins — one exact origin per line
    <textarea id="runtime-origins" rows="4" spellcheck="false"
      placeholder="https://api.example.com&#10;http://localhost:8080">${escape(settings.allowedOrigins.join('\n'))}</textarea></label>
    <div class="runtime-grid"><label class="tool-field">Request deadline (ms)
    <input id="runtime-timeout" type="number" min="1" max="600000" value="${settings.timeoutMs}"></label>
    <label class="tool-field">Maximum response bytes
    <input id="runtime-response" type="number" min="1" max="67108864" value="${settings.maxResponseBytes}"></label></div>
    <p>Denied by default. Grants are not saved in ZIPs, projects, or local recovery. Cookies and automatic redirects are disabled.
      Browser CORS, HTTPS/mixed-content and server CSP rules still apply. Stop/relaunch to use changed settings.</p>
    <button class="button" id="runtime-revoke">Revoke grants and stop matching applications</button></section>`;
}

function readSettings(element, state) {
  const field = id => element.querySelector(id);
  return {
    enabled: field('#runtime-network').checked,
    allowedOrigins: field('#runtime-origins').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    timeoutMs: Number(field('#runtime-timeout').value), maxResponseBytes: Number(field('#runtime-response').value),
    compute: { backend: field('#runtime-backend').value, workers: Number(field('#runtime-workers').value) },
    langVersion: state.projectSystem ? state.langVersion : field('#runtime-language').value
  };
}

function bindView(tool, element) {
  const target = element.querySelector('#runtime-target');
  if (target) target.onchange = () => {
    try { tool.settingsProvider.select(target.value); renderRuntimeSettings(tool, element); }
    catch (error) { tool.toast(error.message, 'error'); }
  };
  element.querySelector('#runtime-refresh').onclick = () => tool.refresh();
  element.querySelector('#runtime-apply').onclick = async () => {
    try {
      tool.configure(readSettings(element, tool.state));
      element.querySelector('#runtime-status').textContent = 'Applied. Existing sessions retain their original grants.';
      if (!tool.state.readOnly) await tool.build();
    } catch (error) {
      element.querySelector('#runtime-status').textContent = error.message;
      tool.toast(error.message, 'error');
    }
  };
  element.querySelector('#runtime-revoke').onclick = async () => {
    try { await tool.settingsProvider.revokeAndStop(); renderRuntimeSettings(tool, element); }
    catch (error) { tool.toast(error.message, 'error'); }
  };
}

/** Render the shared settings form using its explicit profile/session provider. */
export function renderRuntimeSettings(tool, element) {
  const settings = tool.settings();
  const runtime = tool.state.debug?.runtime ?? { status: 'Run a program to see actual backend and transport metrics.' };
  element.innerHTML = `<div class="tool-page runtime-page"><header class="runtime-header">
    <div><h2>Language & runtime</h2><p>Managed browser execution · explicit host capabilities</p></div>
    <button class="button" id="runtime-refresh">Refresh metrics</button></header>
    ${targetSection(tool.settingsProvider)}${languageSection(settings, !!tool.state.projectSystem)}
    ${computeSection(settings)}${networkSection(settings)}
    <div class="tool-actions"><button class="button primary" id="runtime-apply" ${settings.unavailable ? 'disabled' : ''}>Apply to next launch</button>
      <span id="runtime-status" role="status"></span></div>
    <section><h3>Observed runtime capabilities</h3><pre id="runtime-metrics">${escape(JSON.stringify(runtime, null, 2))}</pre>
    <p>Reverse debugging starts a new history segment after external I/O or worker jobs.
      An external request cannot be undone or replayed by restoring a managed snapshot.</p></section></div>`;
  bindView(tool, element);
}
