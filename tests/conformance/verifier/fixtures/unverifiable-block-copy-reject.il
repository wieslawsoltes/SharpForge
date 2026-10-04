// SharpForge-authored ECMA-335 sixth edition III.3.30 fixture.
.assembly extern System.Runtime {}
.assembly unverifiable_block_copy_reject {}
.module unverifiable_block_copy_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32, int32)
  ldloca.s 0 ldloca.s 1 ldc.i4.4 cpblk ret
 }
}
