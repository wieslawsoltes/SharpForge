// SharpForge-authored ECMA-335 sixth edition III.3.19 fixture.
.assembly extern System.Runtime {}
.assembly generic_method_constraint_reject {}
.module generic_method_constraint_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target<class T>() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  call void Test::Target<int32>() ret
 }
}
