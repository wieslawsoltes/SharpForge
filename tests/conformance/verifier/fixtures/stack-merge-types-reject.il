// SharpForge-authored ECMA-335 sixth edition III.1.8.1.3 fixture.
.assembly extern System.Runtime {}
.assembly stack_merge_types_reject {}
.module stack_merge_types_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.0 brtrue.s SECOND ldc.i4.1 br.s JOIN SECOND: ldnull JOIN: pop ret
 }
}
