// SharpForge-authored ECMA-335 sixth edition III.2.4 fixture.
.assembly extern System.Runtime {}
.assembly tail_void_return_accept {}
.module tail_void_return_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  tail. call void Test::Target() ret
 }
}
