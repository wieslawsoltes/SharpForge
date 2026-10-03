class C { int x; public ref int GetPinnableReference()=>ref x; unsafe void M(){fixed(int* p=this){}} }
