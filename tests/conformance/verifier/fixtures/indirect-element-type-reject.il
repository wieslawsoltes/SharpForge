// SharpForge-authored ECMA-335 sixth edition III.3.42 fixture.
.assembly extern System.Runtime {}
.assembly indirect_element_type_reject {}
.module indirect_element_type_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldloca.s 0 ldind.i8 pop ret
 }
}
