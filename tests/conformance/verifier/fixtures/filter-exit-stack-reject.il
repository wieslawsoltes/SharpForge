// SharpForge-authored ECMA-335 sixth edition III.3.34 fixture.
.assembly extern System.Runtime {}
.assembly filter_exit_stack_reject {}
.module filter_exit_stack_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  .try { leave.s DONE } filter { ldc.i4.0 endfilter } { pop leave.s DONE } DONE: ret
 }
}
