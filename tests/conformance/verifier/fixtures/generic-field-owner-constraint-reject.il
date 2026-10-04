// SharpForge-authored ECMA-335 sixth edition III.4.14 fixture.
.assembly extern System.Runtime {}
.assembly generic_field_owner_constraint_reject {}
.module generic_field_owner_constraint_reject.dll
.class public auto ansi Generic`1<class T> extends [System.Runtime]System.Object {
 .field public static int32 Value
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldsfld int32 class Generic`1<int32>::Value pop ret
 }
}
