// SharpForge-authored ECMA-335 sixth edition III.4.3 fixture.
.assembly extern System.Runtime {}
.assembly type_access_reject {}
.module type_access_reject.dll
.class public auto ansi Outer extends [System.Runtime]System.Object {
 .class nested private auto ansi Hidden extends [System.Runtime]System.Object {}
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldnull castclass Outer/Hidden pop ret
 }
}
