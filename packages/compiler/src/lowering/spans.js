import {ArrayTypeSymbol} from '../symbols/types.js';
import {n} from '../codegen/semantic/node-factory.js';
import {managedAddress, spanElement, spanDefault, spanLength, spanSlice, spanReadOnly, stackAllocation} from '../codegen/memory-nodes.js';
import {memoryCall} from './memory-builtins.js';
import {isByReference} from './by-reference.js';

const integer = value => n.literal(value, 'int');
const spanType = (type, core) => type?.originalDefinition === core.span || type?.originalDefinition === core.readOnlySpan;
const readonlySpan = (type, core) => type?.originalDefinition === core.readOnlySpan;

export const SpanTranslation = Base => class extends Base {
  defaultValue(type) {
    return /^System\.(?:ReadOnly)?Span</.test(type) ? spanDefault(type) : super.defaultValue(type);
  }
  exprTypeOf(node) {
    return memoryCall('typeOf', [n.literal(this.imageType(node.operandType, node.syntax), 'string')], 'System.Type');
  }
  exprStackAlloc(node) {
    const element = this.imageType(node.elementType, node.syntax);
    const values = node.elements?.map(value => this.expression(value)) ?? null;
    const length = node.sizes?.length ? this.expression(node.sizes[0]) : integer(values?.length ?? 0);
    return stackAllocation(element, length, values);
  }
  exprIndexerAccess(node) {
    if (!spanType(node.receiver?.type, this.g.analysis.core)) return super.exprIndexerAccess(node);
    return spanElement(this.expression(node.receiver), this.expression(node.args[0].expression),
      this.imageType(node.type, node.syntax), readonlySpan(node.receiver.type, this.g.analysis.core));
  }
  exprPropertyAccess(node) {
    if (!spanType(node.receiver?.type, this.g.analysis.core)) return super.exprPropertyAccess(node);
    const length = spanLength(this.expression(node.receiver));
    if (node.property.name === 'Length') return length;
    if (node.property.name === 'IsEmpty') return n.equals(length, integer(0));
    return super.exprPropertyAccess(node);
  }
  exprCall(node) {
    if (!spanType(node.receiver?.type, this.g.analysis.core)) return super.exprCall(node);
    const span = this.expression(node.receiver);
    if (node.method.name === 'Slice') return spanSlice(span, this.arguments(node, node.method));
    if (node.method.name === 'ToArray') return memoryCall('spanToArray', [span], this.imageType(node.type, node.syntax));
    return super.exprCall(node);
  }
  exprConversion(node) {
    const core = this.g.analysis.core;
    if (!spanType(node.type, core)) return super.exprConversion(node);
    const value = this.expression(node.operand), type = this.imageType(node.type, node.syntax);
    if (value.legacyType === type) return value;
    if (spanType(node.operand.type, core) && readonlySpan(node.type, core)) return spanReadOnly(value);
    if (node.operand.type instanceof ArrayTypeSymbol) return memoryCall('spanFromArray', [value, n.literal(type, 'string')], type);
    if (node.operand.type?.specialType === 'System_String') return memoryCall('spanFromString', [value, n.literal(type, 'string')], type);
    return super.exprConversion(node);
  }
  target(node) {
    if (node.kind === 'IndexerAccess' && spanType(node.receiver?.type, this.g.analysis.core)) return this.exprIndexerAccess(node);
    return super.target(node);
  }
  stmtForEach(node) {
    if (!node.local || !spanType(node.collection?.type, this.g.analysis.core)) return super.stmtForEach(node);
    return this.scoped(() => {
      const syntax = this.span(node.syntax), type = this.imageType(node.collection.type, node.syntax);
      const span = this.holder(type, 'span'), index = this.holder('int', 'index');
      const element = spanElement(span.read(), index.read(), this.imageType(node.local.type, node.syntax),
        readonlySpan(node.collection.type, this.g.analysis.core));
      const value = isByReference(node.local) ? managedAddress(element, {readonly: element.readonly}) : element;
      const body = this.scoped(() => [...this.declareVariable(node.local, value, syntax), this.embedded(node.body)]);
      return [span.init(this.expression(node.collection), syntax), index.init(integer(0)), {
        kind: 'ForStatement', syntax, locals: [], initializer: null,
        condition: n.binary('<', index.read(), spanLength(span.read()), 'bool'), body,
        increment: n.assign(index.read(), n.binary('+', index.read(), integer(1), 'int')), labels: []
      }];
    });
  }
};
