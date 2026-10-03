// SharpForge-authored ECMA-335 sixth edition III.2.6 fixture.
.assembly extern System.Runtime {}
.assembly volatile_prefix_reject {}
.module volatile_prefix_reject.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  volatile.
 nop
 ret
 }
}
