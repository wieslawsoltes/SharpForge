// SharpForge-authored ECMA-335 sixth edition III.3.57 fixture.
.assembly extern System.Runtime {}
.assembly return_in_handler_accept {}
.module return_in_handler_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { leave.s DONE } catch [System.Runtime]System.Exception { pop leave.s DONE } DONE: ret
 }
}
