class C { static int F(params System.ReadOnlySpan<int> xs) => xs.Length; int M()=>F(1,2); }
