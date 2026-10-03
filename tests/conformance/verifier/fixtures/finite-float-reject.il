// SharpForge-authored ECMA-335 sixth edition III.3.24 fixture.
.assembly extern System.Runtime {}
.assembly finite_float_reject {}
.module finite_float_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.1 ckfinite pop ret
 }
}
