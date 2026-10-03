// SharpForge-authored ECMA-335 sixth edition III.2.4 fixture.
.assembly extern System.Runtime {}
.assembly tail_return_type_accept {}
.module tail_return_type_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static int32 Target() cil managed { ldc.i4.0 ret }
 .method public static string OtherTarget() cil managed { ldnull ret }
 .method public static int32 Run() cil managed {
  .maxstack 8
  .locals init (int32)
  tail. call int32 Test::Target() ret
 }
}
