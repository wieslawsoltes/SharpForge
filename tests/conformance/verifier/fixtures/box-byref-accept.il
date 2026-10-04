// SharpForge-authored ECMA-335 sixth edition III.4.1 fixture.
.assembly extern System.Runtime {}
.assembly box_byref_accept {}
.module box_byref_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldloc.0 box int32 pop ret
 }
}
