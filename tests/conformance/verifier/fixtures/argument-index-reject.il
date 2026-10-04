// SharpForge-authored ECMA-335 sixth edition III.3.38 fixture.
.assembly extern System.Runtime {}
.assembly argument_index_reject {}
.module argument_index_reject.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run(int32 argument) cil managed {
  .locals init (int32 local)
  .maxstack 8
  ldarg.1
 pop
 ret
 }
}
