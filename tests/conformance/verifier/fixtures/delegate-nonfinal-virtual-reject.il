// SharpForge-authored ECMA-335 sixth edition III.3.41 fixture.
.assembly extern System.Runtime {}
.assembly delegate_nonfinal_virtual_reject {}
.module delegate_nonfinal_virtual_reject.dll
.class public auto ansi VirtualBase extends [System.Runtime]System.Object {
 .method public virtual instance void Target() cil managed { ret }
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run(class VirtualBase target) cil managed {
  .maxstack 8
  .locals init (int32)
  ldarg.0 ldftn instance void VirtualBase::Target() newobj instance void [System.Runtime]System.Action::.ctor(object, native int) pop ret
 }
}
