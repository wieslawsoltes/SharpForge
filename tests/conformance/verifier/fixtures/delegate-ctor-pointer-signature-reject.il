// SharpForge-authored ECMA-335 sixth edition III.1.8.1.5 fixture.
.assembly extern System.Runtime {}
.assembly delegate_ctor_pointer_signature_reject {}
.module delegate_ctor_pointer_signature_reject.dll
.class public auto ansi sealed D extends [System.Runtime]System.MulticastDelegate {
 .method public hidebysig specialname rtspecialname instance void .ctor(object, int32) runtime managed {}
 .method public virtual instance void Invoke() runtime managed {}
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldnull ldftn void Test::Target() newobj instance void D::.ctor(object, int32) pop ret
 }
}
