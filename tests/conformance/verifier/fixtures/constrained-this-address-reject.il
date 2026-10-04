// SharpForge-authored ECMA-335 sixth edition III.2.1 fixture.
.assembly extern System.Runtime {}
.assembly constrained_this_address_reject {}
.module constrained_this_address_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldloc.0 constrained. [System.Runtime]System.Int32 callvirt instance string [System.Runtime]System.Object::ToString() pop ret
 }
}
