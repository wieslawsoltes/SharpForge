import {WorkspaceSearchController} from './workspace-search.js';

function showResults(element, controller, state, escape) {
  const results = element.querySelector('#workspace-search-results');
  if (state.kind !== 'results') {
    results.textContent = state.message;
    return;
  }
  const binding = state.result;
  results.innerHTML = `<p>${binding.matches.length} matches${binding.truncated ? ' (result limit reached)' : ''}</p>` +
    binding.matches.map((match, index) => `<button class="search-result" data-search-result="${index}">` +
      `<b>${escape(match.uri)}:${match.line + 1}</b><code>${escape(match.preview)}</code></button>`).join('');
  for (const button of results.querySelectorAll('[data-search-result]')) {
    button.onclick = () => controller.navigate(binding, Number(button.dataset.searchResult));
  }
}

function installSearchPanel(element, context) {
  element.innerHTML = `<div class="tool-page"><h2>Find in Files</h2>
    <label class="tool-field">Search <input id="workspace-search" maxlength="1024" placeholder="Literal text in workspace files"></label>
    <div class="tool-actions"><label><input id="search-case" type="checkbox"> Match case</label>
    <label><input id="search-word" type="checkbox"> Whole word</label><button id="search-again">Search again</button>
    <button id="search-cancel">Cancel search</button></div>
    <label class="tool-field">Replace with <input id="workspace-replace"></label>
    <button class="button" id="replace-preview">Preview replace all</button>
    <div id="workspace-search-results" role="status" aria-live="polite"></div></div>`;
  const input = element.querySelector('#workspace-search');
  const replacement = element.querySelector('#workspace-replace');
  const options = () => ({matchCase: element.querySelector('#search-case').checked, wholeWord: element.querySelector('#search-word').checked});
  const controller = new WorkspaceSearchController({context: () => context.explorerContext(),
    request: (...args) => context.requestCompiler(...args), load: (...args) => context.loadWorkspaceRecord(...args),
    open: (...args) => context.openFile(...args), show: state => showResults(element, controller, state, context.E)});
  let previewGeneration = 0;
  const search = () => { previewGeneration++; return controller.search(input.value, options()); };
  input.oninput = search;
  element.querySelector('#search-case').onchange = search;
  element.querySelector('#search-word').onchange = search;
  element.querySelector('#search-again').onclick = search;
  element.querySelector('#search-cancel').onclick = () => { previewGeneration++; controller.cancel(); };
  replacement.oninput = () => { previewGeneration++; };
  element.querySelector('#replace-preview').onclick = async () => {
    const generation = ++previewGeneration;
    const intent = controller.capture();
    const current = () => generation === previewGeneration && controller.isCurrent(intent);
    try {
      const action = await context.requestCompiler('replaceAll', {query: input.value, replacement: replacement.value, options: options()});
      if (!current()) return;
      const edits = action.edits.slice(0, 100).map(edit => `${edit.uri} [${edit.start}, ${edit.end}) → ${edit.newText}`).join('\n');
      context.showModal(action.title,
        `<p>${action.edits.length} version-checked edits. Candidate compilation is checked before application.</p><pre>${context.E(edits)}</pre>`,
        {footer: '<button id="apply-search-replace">Apply edits</button><button id="modal-done">Cancel</button>'});
      context.$('#apply-search-replace').onclick = async () => {
        if (!current()) { context.toast('Search or workspace changed. Preview the replacement again.', 'error'); return; }
        try {
          await context.applyRefactoring(action);
          if (generation !== previewGeneration || !controller.sameIdentity(intent)) return;
          context.closeModal();
          search();
        } catch (error) {
          if (current()) context.toast(error.message, 'error');
        }
      };
    } catch (error) {
      if (current()) context.toast(error.message, 'error');
    }
  };
  return controller;
}

/** Each renderer owns its panels; retained DOM observes workspace changes instead of retaining actionable stale results. */
export function createWorkspaceSearchPanel(context) {
  const panels = new Map();
  return {
    render(element) {
      let controller = panels.get(element);
      if (controller && !element.querySelector('#workspace-search')) { controller.dispose(); panels.delete(element); controller = null; }
      if (!controller) { controller = installSearchPanel(element, context); panels.set(element, controller); }
      controller.observe();
      return true;
    },
    observe() { for (const controller of panels.values()) controller.observe(); },
    dispose() { for (const controller of panels.values()) controller.dispose(); panels.clear(); },
  };
}
