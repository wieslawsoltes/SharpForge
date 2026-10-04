// SharpForge-authored ECMA-335 sixth edition III.1.8.1.4 fixture.
.assembly extern System.Runtime {}
.assembly constructor_this_use_reject {}
.module constructor_this_use_reject.dll

.class public auto ansi  Test extends [System.Runtime]System.Object {
 .method public static void Consume(object) cil managed { ret }
 .method public hidebysig specialname rtspecialname instance void .ctor() cil managed {
  .maxstack 8
  .locals init (int32)
  ldarg.0 call void Test::Consume(object) ldarg.0 call instance void [System.Runtime]System.Object::.ctor() ret
 }
}
