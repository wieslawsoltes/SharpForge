// SharpForge-authored ECMA-335 sixth edition III.3.19 fixture.
.assembly extern System.Runtime {}
.assembly call_abstract_accept {}
.module call_abstract_accept.dll
.class public auto ansi abstract AbstractBase extends [System.Runtime]System.Object {
 .method public hidebysig specialname rtspecialname instance void .ctor() cil managed {
  ldarg.0 call instance void [System.Runtime]System.Object::.ctor() ret
 }
 .method public virtual abstract instance void Target() cil managed {}
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run(class AbstractBase value) cil managed {
  .maxstack 8
  .locals init (int32)
  ldarg.0 callvirt instance void AbstractBase::Target() ret
 }
}
