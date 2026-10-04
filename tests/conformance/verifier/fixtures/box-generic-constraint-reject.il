// SharpForge-authored ECMA-335 sixth edition III.4.1 fixture.
.assembly extern System.Runtime {}
.assembly box_generic_constraint_reject {}
.module box_generic_constraint_reject.dll
.class public auto ansi Generic`1<class T> extends [System.Runtime]System.Object {
 .field public static int32 Value
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldnull box class Generic`1<int32> pop ret
 }
}
