// SharpForge-authored ECMA-335 sixth edition III.3.35 fixture.
.assembly extern System.Runtime {}
.assembly endfinally_handler_accept {}
.module endfinally_handler_accept.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  .try { leave.s DONE } finally { endfinally }
  DONE: ret
 }
}
