import { taskResult, findContracts } from '@sharpforge/framework';
import { Op, frameworkBuiltin } from '@sharpforge/bytecode';
import { MethodCompiler } from '../method-compiler.js';
import { DiagnosticId } from '../diagnostics/codes.js';

/** Top-level statements receive C#'s implicit args parameter in both execution pipelines. */
export function declareTopLevelEntry(compilation, { file, statements }) {
  const span = { uri: file.source.uri, start: 0, end: file.source.length };
  const args = { kind: 'Parameter', name: 'args', type: 'string[]', ...span, hidden: true };
  return compilation.declareMethod(null, {
    kind: 'Method', name: '<Main>', returnType: 'void', parameters: [args], modifiers: ['static'],
    body: { kind: 'Block', statements, ...span }, ...span
  });
}

function emitEntryCall(emitter, entry, awaited, awaitBuiltin) {
  for (let index = 0; index < entry.parameters.length; index++) emitter.emit(Op.LDLOC, index);
  emitter.emit(Op.CALL, entry.id, entry.parameters.length);
  if (awaited) {
    if (awaitBuiltin) emitter.emit(Op.BUILTIN, awaitBuiltin.id, 1);
    else {
      emitter.emit(Op.POP);
      emitter.emitConstant(null);
    }
  }
  emitter.emit(Op.RET);
}

function emitLegacyInitializers(compilation, startup, fields, tail) {
  const emitter = new MethodCompiler(compilation, startup);
  for (const field of fields) {
    emitter.m.owner = field.owner;
    const type = emitter.typedExpr(field.node.initializer, field.type);
    emitter.checkAssign(field.type, type, field.node);
    emitter.emit(Op.STSTATIC, field.index);
    emitter.emit(Op.POP);
  }
  emitter.m.owner = null;
  tail(emitter);
  emitter.finish();
}

/** Forward entry arguments after static initialization, preserving task-await and exit-code behavior. */
export function declareEntryStartup(compilation, entry, bound) {
  if (entry.node.asyncRole === 'kickoff' && entry.returnType === 'void') compilation.report(entry.node, DiagnosticId.CS4009);
  const node = {
    ...entry.node,
    name: '<startup>',
    // Synthetic names keep user static field initializers from seeing Main's lexical parameter names.
    parameters: entry.parameters.map((parameter, index) => ({ ...parameter, name: '$entry' + index, hidden: true })),
    returnType: taskResult(entry.returnType) ?? entry.returnType,
    modifiers: ['static'],
    body: { kind: 'Block', statements: [], start: 0, end: 0, uri: entry.node.uri }
  };
  const startup = compilation.declareMethod(null, node, true);
  const awaited = taskResult(entry.returnType) !== null;
  const awaitContract = awaited
    ? findContracts('SharpForge.Runtime.Async', 'Await', true).find(contract => contract.parameters[0] === entry.returnType)
    : null;
  const awaitBuiltin = awaitContract ? frameworkBuiltin(awaitContract) : null;
  const tail = emitter => emitEntryCall(emitter, entry, awaited, awaitBuiltin);
  const fields = compilation.statics.filter(field => field.node.initializer);
  if (bound) bound.bindInitializers(startup, fields, { ownerPerField: true, tail });
  else emitLegacyInitializers(compilation, startup, fields, tail);
  if (awaited && !awaitBuiltin) compilation.report(entry.node, DiagnosticId.CS0028, [entry.qualifiedName], 'error');
  return startup.id;
}
