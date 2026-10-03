delegate int D(int x); class C { static int F(int x){return x;} D d=new D(F); }
