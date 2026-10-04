// SharpForge-authored ECMA-335 sixth edition III.3.57 fixture.
.assembly extern System.Runtime {}
.assembly return_in_try_reject {}
.module return_in_try_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { ret } finally { endfinally } ret
 }
}
