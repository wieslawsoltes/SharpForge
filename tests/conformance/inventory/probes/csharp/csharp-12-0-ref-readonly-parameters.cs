class C { static int F(ref readonly int x)=>x; int M() { int x=1; return F(in x); } }
