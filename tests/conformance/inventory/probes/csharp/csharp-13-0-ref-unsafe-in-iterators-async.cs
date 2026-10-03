class C { static System.Collections.Generic.IEnumerable<int> M() { int x=1; { ref int y=ref x; y++; } yield return x; } }
