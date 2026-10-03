class A : System.Attribute { public A(string s){} } class C { [A(nameof(x))] void M(int x) {} }
