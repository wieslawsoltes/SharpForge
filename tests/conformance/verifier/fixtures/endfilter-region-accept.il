// SharpForge-authored ECMA-335 sixth edition III.3.34 fixture.
.assembly extern System.Runtime {}
.assembly endfilter_region_accept {}
.module endfilter_region_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { leave.s DONE } filter { pop ldc.i4.0 endfilter } { pop leave.s DONE } DONE: ret
 }
}
