// SharpForge-authored ECMA-335 sixth edition III.3.19 fixture.
.assembly extern System.Runtime {}
.assembly method_access_reject {}
.module method_access_reject.dll
.class public auto ansi Other extends [System.Runtime]System.Object {
 .field public static int32 Static
 .field public int32 Instance
 .field private static int32 Hidden
 .field public initonly int32 Readonly
 .method public hidebysig specialname rtspecialname instance void .ctor() cil managed {
  ldarg.0 call instance void [System.Runtime]System.Object::.ctor() ret
 }
 .method public instance void NotCtor() cil managed { ret }
 .method public static void Visible() cil managed { ret }
 .method private static void HiddenMethod() cil managed { ret }
}
.class public auto ansi  Test extends [System.Runtime]System.Object {
 
 .method public static void Run() cil managed {
  .maxstack 8
  .locals init (int32)
  call void Other::HiddenMethod() ret
 }
}
