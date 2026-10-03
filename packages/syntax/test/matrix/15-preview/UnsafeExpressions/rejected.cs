// langversion 14: expect CS8652 at 115 "unsafe"
// preview: csharplang/proposals/unsafe-evolution.md revision 1 commit 412dc3023500
class C
{
    int M(int* p) => unsafe(*p);
}
