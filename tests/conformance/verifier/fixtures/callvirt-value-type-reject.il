// SharpForge-authored ECMA-335 sixth edition III.4.2 fixture.
.assembly extern System.Runtime {}
.assembly callvirt_value_type_reject {}
.module callvirt_value_type_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldloca.s 0 callvirt instance string [System.Runtime]System.Int32::ToString() pop ret
 }
}
