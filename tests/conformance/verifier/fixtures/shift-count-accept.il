// SharpForge-authored ECMA-335 sixth edition III.3.58 fixture.
.assembly extern System.Runtime {}
.assembly shift_count_accept {}
.module shift_count_accept.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  ldc.i4.1
 ldc.i4.0
 shl
 pop
 ret
 }
}
