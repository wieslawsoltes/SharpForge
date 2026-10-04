import { diffLines } from './lines.js';
import { isBinary } from '../eol.js';
import { checkLimit } from '../errors.js';
import { quoteGitPath } from './path.js';

const decoder = new TextDecoder();

/** Group operations into unified hunks, retaining selectable line identities. */
export function createHunks(changes, { context = 3 } = {}) {
  checkLimit(context, 100000, 'Patch context');
  const spans = [];
  for (let index = 0; index < changes.length; index++) {
    if (changes[index].type === 'equal') continue;
    const start = Math.max(0, index - context);
    const end = Math.min(changes.length, index + context + 1);
    if (spans.length && start <= spans.at(-1).end) spans.at(-1).end = end;
    else spans.push({ start, end });
  }
  return spans.map(({ start, end }) => {
    const lines = changes.slice(start, end).map((line, index) => ({ ...line, index: start + index }));
    const oldLines = lines.filter(line => line.type !== 'insert').length;
    const newLines = lines.filter(line => line.type !== 'delete').length;
    return { oldStart: lines[0].oldLine - (oldLines ? 0 : 1), oldLines,
      newStart: lines[0].newLine - (newLines ? 0 : 1), newLines, lines };
  });
}

function range(start, count) {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function quotePath(path) {
  return quoteGitPath(path);
}

/** Format a textual or binary Git patch including rename/copy/mode headers. */
export function formatPatch(before, after, options = {}) {
  const { oldPath = options.path ?? 'file', newPath = options.path ?? oldPath, oldMode, newMode, oldOid, newOid, status } = options;
  let result = `diff --git ${quotePath(`a/${oldPath}`)} ${quotePath(`b/${newPath}`)}\n`;
  if (!oldMode && newMode) result += `new file mode ${newMode.toString(8)}\n`;
  else if (oldMode && !newMode) result += `deleted file mode ${oldMode.toString(8)}\n`;
  else if (oldMode && newMode && oldMode !== newMode) result += `old mode ${oldMode.toString(8)}\nnew mode ${newMode.toString(8)}\n`;
  if (status === 'R' || status === 'C') {
    const operation = status === 'R' ? 'rename' : 'copy';
    result += `similarity index ${options.similarity ?? 100}%\n${operation} from ${quotePath(oldPath)}\n${operation} to ${quotePath(newPath)}\n`;
  }
  if (oldOid && newOid) result += `index ${oldOid.slice(0, 7)}..${newOid.slice(0, 7)}${oldMode === newMode && oldMode ? ` ${oldMode.toString(8)}` : ''}\n`;
  const oldBytes = typeof before === 'string' ? new TextEncoder().encode(before) : before;
  const newBytes = typeof after === 'string' ? new TextEncoder().encode(after) : after;
  if (isBinary(oldBytes) || isBinary(newBytes)) return `${result}Binary files a/${oldPath} and b/${newPath} differ\n`;
  const hunks = createHunks(diffLines(decoder.decode(oldBytes), decoder.decode(newBytes), options), options);
  if (!hunks.length) return result;
  result += `--- ${oldMode === 0 ? '/dev/null' : quotePath(`a/${oldPath}`)}\n`;
  result += `+++ ${newMode === 0 ? '/dev/null' : quotePath(`b/${newPath}`)}\n`;
  for (const hunk of hunks) {
    result += `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@\n`;
    for (const operation of hunk.lines) {
      const marker = operation.type === 'insert' ? '+' : operation.type === 'delete' ? '-' : ' ';
      result += marker + operation.line;
      if (!operation.line.endsWith('\n')) result += '\n\\ No newline at end of file\n';
    }
  }
  return result;
}
