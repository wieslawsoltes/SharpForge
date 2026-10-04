import {escapeHtml as escape} from '@sharpforge/editor';

function inspectedValues(result, filter) {
  let html = '';
  if (result.Properties) html += '<h3>Evaluated properties</h3><table class="data-table">' + Object.entries(result.Properties)
    .filter(([name, value]) => (name + ' ' + value).toLowerCase().includes(filter)).map(([name, value]) =>
      `<tr><td>${escape(name)}</td><td class="native-property-value">${escape(value)}</td></tr>`).join('') + '</table>';
  for (const [kind, items] of Object.entries(result.Items ?? {})) {
    const list = items.filter(item => (kind + JSON.stringify(item)).toLowerCase().includes(filter));
    if (!list.length) continue;
    html += `<details open><summary>${escape(kind)} (${list.length})</summary>` + list.slice(0, 500).map(item =>
      `<details><summary>${escape(item.Identity ?? 'item')}</summary><pre>${escape(JSON.stringify(item, null, 2))}</pre></details>`).join('') +
      (list.length > 500 ? '<p>Showing 500 items; narrow the filter.</p>' : '') + '</details>';
  }
  for (const name of ['targetsText', 'preprocessedText', 'TargetResults', 'Solution']) {
    if (!result[name]) continue;
    html += `<h3>${escape(name)}</h3><pre class="native-expanded-source">` +
      escape(typeof result[name] === 'string' ? result[name] : JSON.stringify(result[name], null, 2)) + '</pre>';
  }
  return html || '<p>No values match.</p>';
}

export function renderNativeInspector(host) {
  const element = host.hosts.get('msbuild-inspector');
  if (!element) return;
  const current = host.inspection;
  if (!current) {
    element.innerHTML = '<div class="tool-page"><h2>MSBuild Evaluation</h2>' +
      '<p>Run Evaluate, List targets or Preprocess from the MSBuild tool to inspect the installed engine’s result.</p></div>';
    return;
  }
  element.innerHTML = `<div class="tool-page msbuild-inspector"><h2>${escape(current.project)}</h2>
    <p>${escape(current.action)} · ${current.action === 'solution-structure' ? 'data-only solution structure' : 'native evaluated result'}</p>
    <input class="native-inspection-filter" aria-label="Filter evaluated properties and items" placeholder="Filter properties and items">
    <div class="native-evaluation-content"></div></div>`;
  const filter = element.querySelector('.native-inspection-filter');
  const render = () => { element.querySelector('.native-evaluation-content').innerHTML = inspectedValues(current.result, filter.value.toLowerCase()); };
  filter.oninput = render;
  render();
}
