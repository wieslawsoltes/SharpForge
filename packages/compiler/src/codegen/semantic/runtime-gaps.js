/**
 * Statements of C# 1 that are bound and checked but need a capability the runtime does not have (SF-A02-T45, T48).
 * Each one is reported as SF2200 with the capability it waits for; nothing is emitted for the program.
 *
 *   lock    - mutual exclusion needs System.Threading.Monitor: managed threads are preempted between any two
 *             instructions, so the statement cannot be lowered to a test and a store without an atomic primitive.
 *   fixed, unsafe blocks - pointers and pinning need addressable storage; the image has typed slots and fields only.
 */

/** Class mixin: statements reported as runtime gaps. */
export const RuntimeGapTranslation = Base =>
  class extends Base {
    stmtLock(node) {
      return this.unsupported('a lock statement (the runtime has no System.Threading.Monitor)', node.syntax.lockKeyword);
    }
    stmtFixed(node) {
      return this.unsupported('a fixed statement (the runtime has no pointers or pinning)', node.syntax.fixedKeyword);
    }
    stmtUnsafe(node) {
      // The block itself changes nothing at run time; a pointer inside it is reported where it is used.
      return this.statement(node.block);
    }
  };
