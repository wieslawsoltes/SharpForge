class C { bool Try(out int x) { x=1;return true; } static int M(C c) { if(c?.Try(out int x)==true) return x; return 0; } }
