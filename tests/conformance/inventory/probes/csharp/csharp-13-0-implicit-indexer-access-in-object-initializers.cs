class C { public int Length => 3; public int this[int i] { get=>i; set{} } static C M() => new C { [^1] = 2 }; }
