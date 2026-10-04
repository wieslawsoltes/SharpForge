// SharpForge-authored ECMA-335 sixth edition III.1.8.1 fixture.
.assembly extern System.Runtime {}
.assembly finally_entry_stack_reject {}
.module finally_entry_stack_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.0 br.s HANDLER .try { leave.s DONE } finally { HANDLER: endfinally } DONE: ret
 }
}
