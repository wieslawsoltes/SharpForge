// SharpForge-authored ECMA-335 sixth edition III.3.41 fixture.
.assembly extern System.Runtime {}
.assembly ldftn_constructor_accept {}
.module ldftn_constructor_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldftn void Test::Target() pop ret
 }
}
