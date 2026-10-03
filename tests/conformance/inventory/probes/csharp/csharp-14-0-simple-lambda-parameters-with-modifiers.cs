delegate void D(ref int x); class C { D d = (ref x) => x++; }
