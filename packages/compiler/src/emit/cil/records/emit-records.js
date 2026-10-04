/**
 * Records (SF-A02-T30): the synthesized members get their bodies (emit-record-members.js), the primary constructor
 * stores its positional parameters, and `with` copies and then assigns.
 *
 *   r with { A = x }    a record class: `r.<Clone>$()` (virtual, so the run-time type is copied), then the init
 *                       accessors; a struct: a copy of the value, then the assignments
 */
import { TypeKind } from '../../../symbols/types.js';
import { RecordMember } from '../../../symbols/synthesized/records.js';
import { isReference } from '../type-facts.js';
import { RecordBody, memberOn } from '../../../codegen/metadata/record-plan.js';
import * as bodies from './emit-record-members.js';

const emitters = Object.freeze({
  [RecordMember.Equals]: bodies.equalsBody,
  [RecordMember.EqualsObject]: bodies.equalsObjectBody,
  [RecordMember.GetHashCode]: bodies.hashBody,
  [RecordMember.ToString]: bodies.toStringBody,
  [RecordMember.Equality]: bodies.equalityOperatorBody,
  [RecordMember.Inequality]: bodies.inequalityOperatorBody,
  [RecordMember.Deconstruct]: bodies.deconstructBody,
  [RecordBody.PrintMembers]: bodies.printMembersBody,
  [RecordBody.EqualityContract]: bodies.equalityContractBody,
  [RecordBody.Clone]: bodies.cloneBody,
  [RecordBody.EqualsBase]: bodies.equalsBaseBody,
});

/** Class mixin: records. */
export const RecordEmission = Base =>
  class extends Base {
    synthesizedBody(method) {
      const emit = emitters[method.recordMember];
      if (!emit) return super.synthesizedBody(method);
      emit.call(this, method.containingType, method);
      return this.il;
    }
    constructorPrologue(constructor) {
      const type = constructor.containingType;
      if (!constructor.isCopyConstructor || !type.isRecord) return super.constructorPrologue(constructor);
      return bodies.copyConstructorPrologue.call(this, type);
    }
    instanceInitializers(type) {
      const constructor = this.frame.method;
      if (type.isRecord && constructor?.isPrimaryConstructor) bodies.positionalInitializers.call(this, type, constructor);
      return super.instanceInitializers(type);
    }
    exprWith(node) {
      if (node.type?.isAnonymousType) return this.anonymousWith(node);
      const il = this.il,
        type = node.type,
        slot = this.temp(type),
        created = { value: () => il.emit('ldloc', slot), address: () => il.emit('ldloca', slot) };
      if (!isReference(type) && type.typeKind === TypeKind.Struct) {
        this.expression(node.receiver);
        il.emit('stloc', slot);
        this.initialize(node, created);
        return il.emit('ldloc', slot);
      }
      if (!type.isRecord || !(type.originalDefinition ?? type).isSource) return this.unsupported(`'with' on '${type.toDisplayString()}'`, node.syntax);
      const clone = this.program.records.membersOf(type).clone;
      this.expression(node.receiver);
      il.emit('callvirt', this.tokens.method(memberOn(type, clone)), { pops: 1, pushes: 1 });
      // The clone is declared by the root record; the copy has the run-time type of the receiver.
      if (!clone.returnType.equals(type.originalDefinition ?? type) || type !== (type.originalDefinition ?? type)) {
        il.emit('castclass', this.tokens.type(type));
      }
      il.emit('stloc', slot);
      this.initialize(node, created);
      return il.emit('ldloc', slot);
    }
  };
