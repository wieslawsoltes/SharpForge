class C { int M(bool b){System.Span<int> s=b?stackalloc int[1]:stackalloc int[2];return s.Length;} }
