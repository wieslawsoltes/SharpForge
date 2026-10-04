const containers = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration']);
const callable = new Set(['MethodDeclaration', 'ConstructorDeclaration', 'DestructorDeclaration', 'OperatorDeclaration',
  'ConversionOperatorDeclaration']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function memberAt(root, offset) {
  let selected = null;
  for (const node of root.descendantNodes()) {
    if (!containers.has(node.parent?.kind) || !node.parent.members?.includes(node)) continue;
    if (offset < node.span.start || offset > node.span.end) continue;
    if (!selected || node.span.end - node.span.start < selected.span.end - selected.span.start) selected = node;
  }
  return selected;
}

function invalidSyntax(member) {
  return !!(member.green.flags & (GreenFlags.ContainsDiagnostics | GreenFlags.ContainsMissing | GreenFlags.ContainsSkippedText));
}

function safeMember(member) {
  if (invalidSyntax(member)) return false;
  // Alias/global-alias attributes can hide ModuleInitializer: reject every possible attributed initializer.
  if (member.attributeLists?.length && member.kind === 'MethodDeclaration' &&
      member.modifiers?.some(token => token.valueText === 'static') && member.returnType?.toString() === 'void' &&
      !member.parameterList?.parameters.length) return false;
  for (const attribute of member.attributeLists ?? []) {
    for (const token of attribute.descendantTokens()) {
      if (['ModuleInitializer', 'ModuleInitializerAttribute'].includes(token.valueText)) return false;
    }
  }
  if (callable.has(member.kind)) return true;
  if (member.kind !== 'PropertyDeclaration' && member.kind !== 'IndexerDeclaration') return false;
  if (member.initializer) return false;
  if (member.expressionBody) return true;
  const accessors = member.accessorList?.accessors ?? [];
  if (!accessors.length || accessors.some(accessor => !accessor.body && !accessor.expressionBody)) return false;
  // C# 14's contextual field creates storage whose initialization/layout order must remain untouched.
  return ![...member.descendantTokens()].some(token => token.valueText === 'field');
}

function validateRequest(workspace, params) {
  if (!params || typeof params.uri !== 'string' || !Number.isSafeInteger(params.version)) {
    throw new TypeError('Outline reorder requires a URI and exact source version');
  }
  const document = workspace.documents.get(params.uri);
  if (!document || document.readOnly || params.uri.startsWith('generated://') || params.uri.startsWith('metadata:')) {
    fail('OUTLINE_READ_ONLY', 'Outline cannot reorder a missing, generated or read-only document');
  }
  const source = document.source;
  if (source.version !== params.version) fail('OUTLINE_STALE', 'Source changed; refresh the outline before reordering');
  for (const offset of [params.sourceStart, params.targetStart]) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw new RangeError('Invalid outline member position');
  }
  if (!['before', 'after'].includes(params.position ?? 'before')) throw new RangeError('Choose before or after the target member');
  return source;
}

/** Lossless, versioned reorder of storage-free members within one type; the workspace is never mutated. */
export function outlineReorder(workspace, params) {
  const source = validateRequest(workspace, params);
  const syntax = workspace.syntax(params.uri), root = syntax.syntax ?? syntax.root;
  if (!root?.descendantNodes) fail('OUTLINE_SYNTAX_REQUIRED', 'Reorder requires the lossless source syntax tree');
  const moving = memberAt(root, params.sourceStart), target = memberAt(root, params.targetStart);
  if (!moving || !target || moving.parent !== target.parent) {
    fail('OUTLINE_CONTAINER', 'Move a member before or after another member of the same type');
  }
  if (!safeMember(moving)) {
    fail('OUTLINE_UNSAFE', 'This declaration can affect initialization or storage layout and cannot be safely reordered');
  }
  const title = `Move ${moving.identifier?.valueText ?? moving.kind} ${params.position ?? 'before'} ${target.identifier?.valueText ?? target.kind}`;
  if (moving === target) return {title, kind: 'refactor.reorder', version: source.version, edits: []};
  const members = [...moving.parent.members], from = members.indexOf(moving), to = members.indexOf(target);
  const first = Math.min(from, to), last = Math.max(from, to), region = members.slice(first, last + 1);
  const start = region[0].fullSpan.start, end = region.at(-1).fullSpan.end;
  if (region.some(invalidSyntax)) fail('OUTLINE_SYNTAX_ERROR', 'Fix syntax errors before reordering this region');
  if ((syntax.directives ?? []).some(directive => (directive.start ?? directive.offset) >= start &&
      (directive.start ?? directive.offset) < end)) {
    fail('OUTLINE_DIRECTIVE', 'Reorder cannot cross or relocate a preprocessor directive');
  }
  for (let index = 1; index < region.length; index++) {
    if (region[index - 1].fullSpan.end !== region[index].fullSpan.start) {
      fail('OUTLINE_TRIVIA', 'The member boundaries do not form one lossless source region');
    }
  }
  const reordered = region.filter(member => member !== moving);
  const insertion = reordered.indexOf(target) + (params.position === 'after' ? 1 : 0);
  reordered.splice(insertion, 0, moving);
  const newText = reordered.map(member => source.text.slice(member.fullSpan.start, member.fullSpan.end)).join('');
  const movedStart = start + reordered.slice(0, insertion).reduce((length, member) => length + member.fullSpan.end - member.fullSpan.start, 0);
  return {title, kind: 'refactor.reorder', uri: params.uri, version: source.version, revision: workspace.revision,
    edits: [{uri: params.uri, start, end, newText, version: source.version}],
    selection: {uri: params.uri, start: movedStart + (moving.identifier?.span.start ?? moving.span.start) - moving.fullSpan.start}};
}
import {GreenFlags} from '@sharpforge/syntax';
