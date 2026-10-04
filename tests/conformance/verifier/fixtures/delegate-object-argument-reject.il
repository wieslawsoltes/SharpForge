// SharpForge-authored ECMA-335 sixth edition III.1.8.1.5 fixture.
.assembly extern System.Runtime {}
.assembly delegate_object_argument_reject {}
.module delegate_object_argument_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Target() cil managed { ret }
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  ldc.i4.0 ldftn void Test::Target() newobj instance void [System.Runtime]System.Action::.ctor(object, native int) pop ret
 }
}
