// SharpForge-authored ECMA-335 sixth edition III.1.8.1.2.2 fixture.
.assembly extern System.Runtime {}
.assembly readonly_byref_write_reject {}
.module readonly_byref_write_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.1 newarr [System.Runtime]System.Int32 ldc.i4.0 readonly. ldelema [System.Runtime]System.Int32 ldc.i4.1 stind.i4 ret
 }
}
