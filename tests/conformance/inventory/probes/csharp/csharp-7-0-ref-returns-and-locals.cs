class C { static ref int F(ref int x)=>ref x; void M(){int x=1;ref int y=ref F(ref x);} }
