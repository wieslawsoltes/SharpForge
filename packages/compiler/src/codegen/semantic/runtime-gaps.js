/**
 * Statements of C# 1 that are bound and checked but need a capability the runtime does not have (SF-A02-T45, T48).
 * Each one is reported as SF2200 with the capability it waits for; nothing is emitted for the program.
 *
 *   lock    - mutual exclusion needs System.Threading.Monitor: managed threads are preempted between any two
 *             instructions, so the statement cannot be lowered to a test and a store without an atomic primitive.
 *   fixed, unsafe blocks - pointers and pinning need addressable storage; the image has typed slots and fields only.
 *
 * Also here: `new object()`, which the framework registry has no constructor for. An object with no members is an
 * image class without fields, so it is lowered rather than reported.
 */
import { n } from './node-factory.js';

const OBJECT_CLASS = 'System.Object';

/** Class mixin: statements reported as runtime gaps, and plain object creation. */
export const RuntimeGapTranslation = Base =>
  class extends Base {
    stmtLock(node) {
      return this.unsupported('a lock statement (the runtime has no System.Threading.Monitor)', node.syntax.lockKeyword);
    }
    stmtFixed(node) {
      return this.unsupported('a fixed statement (the runtime has no pointers or pinning)', node.syntax.fixedKeyword);
    }
    stmtUnsafe(node) {
      return this.unsupported('an unsafe block (the runtime has no pointers)', node.syntax.unsafeKeyword);
    }
    /** `new object()`: a fresh reference with identity and nothing else. */
    plainObject() {
      this.g.plainObjectClass ??= this.g.program.addClass(OBJECT_CLASS);
      return n.allocate(this.g.plainObjectClass);
    }
  };
