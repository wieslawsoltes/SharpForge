class C { [System.Runtime.CompilerServices.OverloadResolutionPriority(1)] static int M(object x)=>1; static int M(string x)=>2; int F()=>M("a"); }
