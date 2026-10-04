// SharpForge-authored ECMA-335 sixth edition III.2.1 fixture.
.assembly extern System.Runtime {}
.assembly constrained_prefix_accept {}
.module constrained_prefix_accept.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldloca.s 0 constrained. [System.Runtime]System.Int32 callvirt instance string [System.Runtime]System.Object::ToString() pop ret
 }
}
