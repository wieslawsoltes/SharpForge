.assembly extern System.Runtime {}
.assembly Boundaries {}
.module Boundaries.dll
.class public abstract sealed Cases extends [System.Runtime]System.Object {
.method public static void Tiny1() cil managed {
      .maxstack 8
      
      ret
    }
.method public static void Tiny63() cil managed {
      .maxstack 8
      
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      ret
    }
.method public static void Fat64() cil managed {
      .maxstack 0
      
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      nop
      ret
    }
.method public static int32 Stack8() cil managed {
      .maxstack 8
      
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      pop
      pop
      pop
      pop
      pop
      pop
      pop
      ret
    }
.method public static int32 Stack9() cil managed {
      .maxstack 9
      
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      ldc.i4.0
      pop
      pop
      pop
      pop
      pop
      pop
      pop
      pop
      ret
    }
.method public static void FatLocalZero() cil managed {
      .maxstack 0
      .locals init (int32 'value')
      ret
    }
  .method public static void InvalidUnderflow() cil managed { .maxstack 1 pop ret }
  .method public static void InvalidJoin() cil managed {
    .maxstack 2
    ldc.i4.0
    brtrue join
    ldc.i4.1
    join: ret
  }
}
