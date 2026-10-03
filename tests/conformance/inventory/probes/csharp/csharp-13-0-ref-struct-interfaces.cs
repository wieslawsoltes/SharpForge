interface I { int M(); } ref struct S : I { public int M()=>1; } class C { static void F<T>(T t) where T : I, allows ref struct {} }
