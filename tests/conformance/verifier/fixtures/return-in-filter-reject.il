// SharpForge-authored ECMA-335 sixth edition III.3.57 fixture.
.assembly extern System.Runtime {}
.assembly return_in_filter_reject {}
.module return_in_filter_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { leave.s DONE } filter { pop ret ldc.i4.0 endfilter } { pop leave.s DONE } DONE: ret
 }
}
