class C { static void F(System.ReadOnlySpan<int> x) {} static void F(System.ReadOnlySpan<long> x) {} static void M() { F([1]); } }
