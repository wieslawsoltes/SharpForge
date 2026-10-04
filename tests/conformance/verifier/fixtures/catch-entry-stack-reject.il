// SharpForge-authored ECMA-335 sixth edition III.1.8.1 fixture.
.assembly extern System.Runtime {}
.assembly catch_entry_stack_reject {}
.module catch_entry_stack_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  br.s HANDLER .try { leave.s DONE } catch [System.Runtime]System.Exception { HANDLER: pop leave.s DONE } DONE: ret
 }
}
