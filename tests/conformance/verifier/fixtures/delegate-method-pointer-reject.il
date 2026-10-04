// SharpForge-authored ECMA-335 sixth edition III.1.8.1.5 fixture.
.assembly extern System.Runtime {}
.assembly delegate_method_pointer_reject {}
.module delegate_method_pointer_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldnull ldc.i4.0 conv.i newobj instance void [System.Runtime]System.Action::.ctor(object, native int) pop ret
 }
}
