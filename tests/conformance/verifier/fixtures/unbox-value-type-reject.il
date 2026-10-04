// SharpForge-authored ECMA-335 sixth edition III.4.32 fixture.
.assembly extern System.Runtime {}
.assembly unbox_value_type_reject {}
.module unbox_value_type_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldnull unbox [System.Runtime]System.String pop ret
 }
}
