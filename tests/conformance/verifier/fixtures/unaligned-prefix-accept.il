// SharpForge-authored ECMA-335 sixth edition III.2.5 fixture.
.assembly extern System.Runtime {}
.assembly unaligned_prefix_accept {}
.module unaligned_prefix_accept.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  ldloca.s 0
  unaligned. 1
  ldind.i4
  pop
  ret
 }
}
