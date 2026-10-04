// SharpForge-authored ECMA-335 sixth edition III.2.5 fixture.
.assembly extern System.Runtime {}
.assembly unaligned_prefix_reject {}
.module unaligned_prefix_reject.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  unaligned. 1
 nop
 ret
 }
}
