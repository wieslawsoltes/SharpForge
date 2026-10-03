// SharpForge-authored ECMA-335 sixth edition III.1.8.1 fixture.
.assembly extern System.Runtime {}
.assembly stack_underflow_accept {}
.module stack_underflow_accept.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  ldc.i4.0
 pop
 ret
 }
}
