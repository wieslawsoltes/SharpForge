/**
 * `lock` (SF-A02-T30), as C# 4 and later define it:
 *
 *   object monitor = expression; bool taken = false;
 *   try { Monitor.Enter(monitor, ref taken); body } finally { if (taken) Monitor.Exit(monitor); }
 *
 * `Enter` is inside the protected region so that an asynchronous exception between the call and the `try` cannot
 * leave the monitor held. A `System.Threading.Lock` (C# 13) is locked through its scope instead (`lockScope`).
 */
import { RefKind } from '../../symbols/types.js';

const MONITOR = 'System_Threading_Monitor';

/** Class mixin: the lock statement. */
export const LockEmission = Base =>
  class extends Base {
    stmtLock(node) {
      const il = this.il,
        core = this.core,
        type = node.expression.type;
      if (type?.name === 'Lock' && type.containingSymbol?.name === 'Threading') return this.lockScope(node);
      const monitorType = core.bridge.coreType(MONITOR),
        enter = { isStatic: true, returnType: core.void, parameters: [{ type: core.object }, { type: core.bool, refKind: RefKind.Ref }] },
        exit = { isStatic: true, returnType: core.void, parameters: [{ type: core.object }] },
        monitor = this.temp(core.object),
        taken = this.temp(core.bool);
      this.expression(node.expression);
      // A type parameter that may be a reference type is locked through its boxed form.
      if (!type?.isReferenceType && type?.kind === 'TypeParameter') il.emit('box', this.tokens.type(type));
      il.emit('stloc', monitor).emit('ldc.i4', 0).emit('stloc', taken);
      return this.tryRegions(
        () => {
          il.emit('ldloc', monitor).emit('ldloca', taken);
          il.emit('call', this.tokens.external(monitorType, 'Enter', enter), { pops: 2, pushes: 0 });
          this.statement(node.body);
        },
        [],
        () => {
          const skip = il.newLabel();
          il.emit('ldloc', taken).emit('brfalse', skip).emit('ldloc', monitor);
          il.emit('call', this.tokens.external(monitorType, 'Exit', exit), { pops: 1, pushes: 0 });
          il.mark(skip);
        },
      );
    }
    /**
     * C# 13: a `System.Threading.Lock` is locked through its scope,
     * `{ Lock.Scope scope = expression.EnterScope(); try { body } finally { scope.Dispose(); } }`.
     * The members come from the referenced library; the framework registry does not declare them.
     */
    lockScope(node) {
      const il = this.il,
        instanceMethod = (owner, name) => owner?.getMembers(name).find(member => !member.isStatic && member.parameters?.length === 0),
        enterScope = instanceMethod(node.expression.type, 'EnterScope'),
        dispose = instanceMethod(enterScope?.returnType, 'Dispose');
      if (!dispose) return this.unsupported('lock over System.Threading.Lock', node.syntax);
      const scopeType = enterScope.returnType,
        scope = this.temp(scopeType);
      this.expression(node.expression);
      this.callMethod(enterScope, { receiver: node.expression, syntax: node.syntax });
      il.emit('stloc', scope);
      return this.tryRegions(
        () => this.statement(node.body),
        [],
        () => {
          il.emit('ldloca', scope);
          this.callMethod(dispose, { receiver: { type: scopeType }, syntax: node.syntax });
        },
      );
    }
  };
