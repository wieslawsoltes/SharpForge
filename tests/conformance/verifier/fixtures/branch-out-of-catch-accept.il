// SharpForge-authored ECMA-335 sixth edition III.1.8.1 fixture.
.assembly extern System.Runtime {}
.assembly branch_out_of_catch_accept {}
.module branch_out_of_catch_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { leave.s DONE } catch [System.Runtime]System.Exception { pop leave.s DONE } DONE: ret
 }
}
