struct S { public int X; public static S operator +(S a,S b){S c=new S();c.X=a.X+b.X;return c;} }
