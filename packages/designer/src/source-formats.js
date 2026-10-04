import { CSharpDesignSession } from './csharp-sync.js';
import { XamlDesignSession } from './xaml-session.js';

export const designSourceFormats = Object.freeze([
  Object.freeze({ id: 'csharp', label: 'C#', matches: uri => /\.cs$/i.test(uri), Session: CSharpDesignSession,
    writeService: 'applySourceEdits', editService: 'editSourceText', viewMode: 'split' }),
  Object.freeze({ id: 'xaml', label: 'XAML', matches: uri => /\.xaml$/i.test(uri), Session: XamlDesignSession,
    writeService: 'applyMarkupSourceEdits', editService: 'editMarkupSourceText', viewMode: 'design' })
]);

/** Select a source provider from an explicit registry; an unsupported extension is never treated as C#. */
export function designSourceFormat(uri, formats = designSourceFormats) {
  const format = formats.find(candidate => candidate.matches(uri));
  if (!format) throw new Error('No designer source provider for ' + uri);
  return format;
}
