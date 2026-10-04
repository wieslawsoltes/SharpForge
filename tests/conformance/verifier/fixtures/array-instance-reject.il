// SharpForge-authored ECMA-335 sixth edition III.4.12 fixture.
.assembly extern System.Runtime {}
.assembly array_instance_reject {}
.module array_instance_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldstr "not an array" ldlen pop ret
 }
}
