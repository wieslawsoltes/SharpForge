import {findTextMatches, expandReplacement} from '@sharpforge/text';
import {readWorkspaceDocument, prepareWorkspaceEdit} from '../services/workspace-edit.js';

export function preserveReplacementCase(replacement, matched) {
  const letters = matched.replace(/[^\p{L}]/gu, '');
  if (!letters) return replacement;
  if (letters === letters.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (letters === letters.toLocaleLowerCase()) return replacement.toLocaleLowerCase();
  const characters = [...matched];
  if (characters[0] === characters[0].toLocaleUpperCase() && characters.slice(1).join('') === characters.slice(1).join('').toLocaleLowerCase()) {
    const result = [...replacement.toLocaleLowerCase()];
    if (result.length) result[0] = result[0].toLocaleUpperCase();
    return result.join('');
  }
  return replacement;
}

export class EditorSearchSession {
  constructor(workspace) {
    this.workspace = workspace;
    this.history = [];
    this.matches = [];
    this.options = {};
    this.query = '';
    this.truncated = false;
  }

  search(query, options = {}) {
    this.query = query;
    this.options = {...options};
    const documents = options.scope === 'open' ? this.workspace.listDocuments?.() ?? [] :
      [readWorkspaceDocument(this.workspace, options.uri)];
    const snapshots = documents.map(document => readWorkspaceDocument(this.workspace, document.uri ?? document.source.uri));
    const result = findTextMatches(snapshots, query, {regex: options.regex, matchCase: options.matchCase,
      wholeWord: options.wholeWord, multiline: true, maxMatches: 10_000, maxSteps: options.maxSteps ?? 2_000_000,
      signal: options.signal, timeLimitMs: options.timeLimitMs ?? 12});
    this.matches = options.scope === 'selection' ? result.matches.filter(match =>
      match.uri === options.uri && match.start >= options.selection.start && match.end <= options.selection.end) : result.matches;
    this.truncated = result.truncated;
    this.documents = new Map(snapshots.map(document => [document.uri, document]));
    return {...result, matches: this.matches};
  }

  remember() {
    if (!this.query) return;
    this.history = [this.query, ...this.history.filter(query => query !== this.query)].slice(0, 50);
  }

  replacement(match, replacement) {
    const document = this.documents.get(match.uri);
    const expanded = this.options.regex ? expandReplacement(replacement, match, document.text) : replacement;
    return this.options.preserveCase ? preserveReplacementCase(expanded, document.text.slice(match.start, match.end)) : expanded;
  }

  prepareReplacement(replacement, matches = this.matches) {
    if (this.truncated) throw new RangeError('Search results are truncated; narrow the scope before replacing');
    const edits = matches.map(match => ({uri: match.uri, version: match.version ?? this.documents.get(match.uri).version,
      start: match.start, end: match.end, newText: this.replacement(match, replacement),
      expectedText: this.documents.get(match.uri).text.slice(match.start, match.end)}));
    return prepareWorkspaceEdit(this.workspace, edits, {label: 'Replace search matches'});
  }
}
