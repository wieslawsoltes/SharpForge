// SharpForge-authored ECMA-335 sixth edition III.4.24 fixture.
.assembly extern System.Runtime {}
.assembly rethrow_handler_accept {}
.module rethrow_handler_accept.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  .try { leave.s DONE } catch [System.Runtime]System.Exception { pop rethrow }
  DONE: ret
 }
}
