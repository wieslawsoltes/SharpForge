// SharpForge-authored ECMA-335 sixth edition III.4.31 fixture.
.assembly extern System.Runtime {}
.assembly throw_reference_reject {}
.module throw_reference_reject.dll
.class public auto ansi sealed Test extends [System.Runtime]System.Object {
 .method public static void Run() cil managed {
  .locals init (int32 local)
  .maxstack 8
  ldc.i4.0
 throw
 }
}
