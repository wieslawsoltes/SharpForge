import {DiagnosticId} from '../diagnostics/codes.js';
import { findContracts } from '@sharpforge/framework';
import { Op, Binary } from '@sharpforge/bytecode';
import { isReference, typeText } from '../type-utils.js';

export function compileForeach(node) {
  const collectionType = this.infer(node.expression);
  const getEnumerator = findContracts(collectionType, 'GetEnumerator', false)[0];
  if (getEnumerator) {
    const name = '$enumerator' + this.locals.length;
    const base = { uri: node.uri, start: node.start, end: node.end };
    const N = n => ({ ...base, kind: 'Name', name: n });
    const M = (target, name) => ({ ...base, kind: 'Member', target, name });
    const call = (target, name) => ({ ...base, kind: 'Call', target: M(target, name), args: [] });
    const enumName = N(name);
    const currentType = findContracts(getEnumerator.result, 'get_Current', false)[0]?.result;
    const tree = {
      ...base, kind: 'Block', statements: [
        {
          ...base, kind: 'Local', declarations: [
            {
              ...base, name, type: getEnumerator.result, hidden: true, initializer: call(node.expression, 'GetEnumerator')
            }
          ]
        }, {
          ...base, kind: 'Try', body: {
            ...base, kind: 'While', labels: node.labels, condition: call(enumName, 'MoveNext'), body: {
              ...base, kind: 'Block', statements: [
                {
                  ...base, kind: 'Local', declarations: [
                    {
                      ...base, name: node.name, nameSpan: node.nameSpan,
                      type: node.type === 'var' ? currentType : node.type,
                      isIteration: true, initializer: M(enumName, 'Current')
                    }
                  ]
                }, node.body
              ]
            }
          }, catches: [], finallyBody: {
            ...base, kind: 'Block', statements: [{ ...base, kind: 'ExpressionStatement', expression: call(enumName, 'Dispose') }]
          }
        }
      ]
    };
    this.stmt(tree);
    return;
  }
  this.scopes.push(new Map());
  this.seq({ ...node, end: node.expression.end });
  const arrayType = this.expr(node.expression);
  if (!arrayType.endsWith('[]'))
    this.c.report(node, DiagnosticId.CS1579, [typeText(arrayType), 'GetEnumerator']);
  const element = arrayType.endsWith('[]') ? arrayType.slice(0, -2) : 'error';
  const arr = this.temp(arrayType);
  const index = this.temp('int');
  this.emit(Op.STLOC, arr);
  this.emit(Op.POP);
  this.emitConstant(0);
  this.emit(Op.STLOC, index);
  this.emit(Op.POP);
  const l = this.local(node.name, node.type === 'var' ? element : this.c.resolveType(node.type, node, false, this.m), { ...node, isIteration: true }, true);
  this.checkAssign(l.type, element, node);
  const start = this.pc;
  this.seq({ ...node, end: node.expression.end });
  this.emit(Op.LDLOC, index);
  this.emit(Op.LDLOC, arr);
  this.emit(Op.LENGTH);
  this.emit(Op.BINARY, Binary['<']);
  const exit = this.emit(Op.JFALSE);
  this.emit(Op.LDLOC, arr);
  this.emit(Op.LDLOC, index);
  this.emit(Op.LDELEM);
  this.emit(Op.STLOC, l.slot);
  this.emit(Op.POP);
  const loop = { breaks: [], continues: [], labels: node.labels ?? [] };
  this.loops.push(loop);
  this.stmt(node.body);
  for (const p of loop.continues)
    this.patch(p);
  this.emit(Op.LDLOC, index);
  this.emitConstant(1);
  this.emit(Op.BINARY, Binary['+'], 1);
  this.emit(Op.STLOC, index);
  this.emit(Op.POP);
  this.emit(Op.JUMP, start);
  this.patch(exit);
  for (const p of loop.breaks)
    this.patch(p);
  this.loops.pop();
  this.clear(arr);
  for (const local of this.scopes.at(-1).values())
    if (isReference(local.type))
      this.clear(local.slot);
  this.closeScope();
  return;
}
