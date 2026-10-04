import { readDesignXaml } from '../../../packages/designer/src/index.js';
import { applyXmlEdits } from '../../../packages/project-system/src/index.js';

/** Use the workspace's existing write transaction and history; never mutate editor or provider internals. */
export function createDesignerMarkupServices({ state, records, perform }) {
  function current(uri, version) {
    if (state.readOnly) throw new Error('Stop debugging before editing XAML');
    const record = records().find(item => (item.path ?? item.uri) === uri);
    if (!record || typeof record.text !== 'string') throw new Error('XAML source is unavailable: ' + uri);
    if ((record.version ?? state.revision) !== version) throw new Error('XAML source changed while editing');
    return record;
  }

  return {
    async applyMarkupSourceEdits(uri, plan, version, beforeApply) {
      const record = current(uri, version);
      if (plan.expectedText !== record.text || applyXmlEdits(record.text, plan.edits) !== plan.text) {
        throw new Error('XAML source changed before designer validation');
      }
      readDesignXaml(plan.text, { uri });
      beforeApply();
      await perform([{ kind: 'write', path: uri, text: plan.text, expectedText: record.text }]);
    },
    async editMarkupSourceText(uri, text, version) {
      const record = current(uri, version);
      if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('XAML source text limit exceeded');
      await perform([{ kind: 'write', path: uri, text, expectedText: record.text }]);
    }
  };
}
