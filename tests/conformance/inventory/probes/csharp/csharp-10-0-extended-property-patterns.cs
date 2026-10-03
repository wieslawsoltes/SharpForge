class C { public C Child; public int X; bool M(C c)=>c is { Child.X: 1 }; }
