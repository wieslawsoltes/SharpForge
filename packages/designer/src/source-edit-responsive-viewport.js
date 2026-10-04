import {sourceComments} from './source-text.js';
import {responsiveSourceFile, responsiveMethodInsertion} from './source-responsive-emission.js';

/** The adapter's marker is owned; ordinary comments survive removal or a change to captured/manual targets. */
export function removeResponsiveViewport(base, result) {
  const viewport = base.responsiveSource?.viewport;
  if (!viewport) return;
  const source = responsiveSourceFile(base, viewport.method);
  const header = sourceComments(source.text.slice(viewport.method.start, viewport.method.body.start));
  const text = [...header, ...viewport.comments.map(comment => comment.text)]
    .map(comment => source.style.methodIndent + comment).join(source.style.newline);
  result.edits.push({uri: source.uri, start: viewport.method.start, end: viewport.method.end,
    text: text + (text ? source.style.newline : '')});
  const statement = viewport.statement;
  const comments = sourceComments(base.text.slice(statement.start, statement.end)).join(base.style.newline);
  result.edits.push({uri: base.uri, start: statement.start, end: statement.end,
    text: comments + (comments ? base.style.newline : '')});
  result.covered.push({...viewport.method, uri: source.uri}, {...statement, uri: base.uri});
  result.structural = true;
}

/** A separate method declaration keeps the original ApplyAdaptive body and its minimal literal edits stable. */
export function insertResponsiveViewport(base, generated, result) {
  if (generated.viewportMethod) result.edits.push(responsiveMethodInsertion(base, {...generated, method: generated.viewportMethod}));
}
