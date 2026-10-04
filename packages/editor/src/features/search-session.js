import {findTextMatches, expandReplacement} from '@sharpforge/text';
import {prepareWorkspaceEdit} from '../services/workspace-edit.js';
import {cooperativeLiteralSearch, workerRegexSearch} from './cooperative-search.js';
import {captureSearchSnapshots, selectionSearchSnapshots, restoreSearchCoordinates, validateSearchSnapshots} from './search-snapshots.js';

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
    this.sequence = (this.sequence ?? 0) + 1;
    this.matches = [];
    this.documents = new Map();
    this.query = query;
    this.options = {...options};
    const snapshots = captureSearchSnapshots(this.workspace, options);
    const inputs = selectionSearchSnapshots(snapshots, options);
    const found = findTextMatches(inputs, query, {regex: options.regex, matchCase: options.matchCase,
      wholeWord: options.wholeWord, multiline: true, maxMatches: 10_000, maxSteps: options.maxSteps ?? 2_000_000,
      signal: options.signal, timeLimitMs: options.timeLimitMs ?? 12});
    const result = restoreSearchCoordinates(found, inputs, snapshots, options);
    this.matches = result.matches;
    this.truncated = result.truncated;
    this.documents = new Map(snapshots.map(document => [document.uri, document]));
    return {...result, matches: this.matches};
  }

  async searchAsync(query, options = {}) {
    const sequence = this.sequence = (this.sequence ?? 0) + 1;
    this.matches = [];
    this.documents = new Map();
    const snapshots = captureSearchSnapshots(this.workspace, options);
    const inputs = selectionSearchSnapshots(snapshots, options);
    const settings = {...options, maxMatches: 10_000};
    const found = options.regex ? await workerRegexSearch(inputs, query, settings) :
      await cooperativeLiteralSearch(inputs, query, settings);
    if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (sequence !== this.sequence) throw new DOMException('Search superseded', 'AbortError');
    validateSearchSnapshots(this.workspace, snapshots);
    const result = restoreSearchCoordinates(found, inputs, snapshots, options);
    this.query = query;
    this.options = {...options};
    this.matches = result.matches;
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
