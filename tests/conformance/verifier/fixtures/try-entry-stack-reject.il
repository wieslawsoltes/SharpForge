// SharpForge-authored ECMA-335 sixth edition III.1.8.1 fixture.
.assembly extern System.Runtime {}
.assembly try_entry_stack_reject {}
.module try_entry_stack_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.0 .try { pop leave.s DONE } finally { endfinally } DONE: ret
 }
}
