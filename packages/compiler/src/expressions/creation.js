import {DiagnosticId} from '../diagnostics/codes.js';
import { Op, BuiltinMap } from '@sharpforge/bytecode';
import { assignable, typeText } from '../type-utils.js';
import { emitArrayCreation } from '../codegen/legacy-array-creation.js';

export function emitNewArray(node) {
  return emitArrayCreation(this, node);
}

export function emitNew(node) {
  if (node.collectionInitializers?.length)
    this.c.report(node, DiagnosticId.SF2013);
  const name = this.c.typeName(node.type, this.m);
  if (name === 'Exception') {
    if (node.args.length > 1)
      this.c.report(node, DiagnosticId.CS1501, ['Exception', node.args.length]);
    if (node.args.length)
      this.checkAssign('string', this.expr(node.args[0]), node.args[0]);
    else
      this.emitConstant('An exception was thrown.');
    this.emit(Op.BUILTIN, BuiltinMap.get('Exception.new').id, 1);
    return 'Exception';
  }
  const type = this.c.findType(name, this.m);
  if (!type) {
    this.c.report(node, DiagnosticId.CS0246, [typeText(name)]);
    this.emitConstant(null);
    return 'error';
  }
  this.emit(Op.NEWOBJ, type.id);
  const slot = this.temp(name);
  this.emit(Op.STLOC, slot);
  this.emit(Op.POP);
  if (type.initializer !== undefined) {
    this.emit(Op.LDLOC, slot);
    this.emit(Op.CALL, type.initializer, 1);
    this.emit(Op.POP);
  }
  const ctors = type.methods.filter(m => m.name === '.ctor');
  const ctor = ctors.find(m => m.parameters.length === node.args.length && m.parameters.every((p, i) => assignable(p.type, this.infer(node.args[i]))));
  if (ctor) {
    this.emit(Op.LDLOC, slot);
    for (let i = 0; i < node.args.length; i++)
      this.typedExpr(node.args[i], ctor.parameters[i].type);
    this.emit(Op.CALL, ctor.id, node.args.length + 1);
    this.emit(Op.POP);
  }
  else if (node.args.length || ctors.length)
    this.c.report(node, DiagnosticId.CS1729, [name, node.args.length]);
  for (const init of node.initializers) {
    const property = type.properties.find(p => p.name === init.name && !p.isStatic);
    const field = type.fields.find(f => f.name === init.name && !f.isStatic);
    if (!property && !field) {
      this.c.report(init, DiagnosticId.CS0117, [name, init.name]);
      continue;
    }
    if (property) {
      const setter = this.propertyAccess(property, { ...init, kind: 'Member' }, 'set');
      if (setter) {
        this.emit(Op.LDLOC, slot);
        this.checkAssign(property.type, this.typedExpr(init.expression, property.type), init);
        this.emit(Op.CALL, setter.id, 2);
        this.emit(Op.POP);
      }
    }
    else {
      this.c.reference(init, field.symbol);
      this.emit(Op.LDLOC, slot);
      this.checkAssign(field.type, this.typedExpr(init.expression, field.type), init);
      this.emit(Op.STFLD, field.index);
      this.emit(Op.POP);
    }
  }
  this.emit(Op.LDLOC, slot);
  this.clear(slot);
  return name;
}
