// SharpForge-authored ECMA-335 sixth edition III.4.12 fixture.
.assembly extern System.Runtime {}
.assembly array_instance_accept {}
.module array_instance_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.1 newarr [System.Runtime]System.Int32 ldlen pop ret
 }
}
