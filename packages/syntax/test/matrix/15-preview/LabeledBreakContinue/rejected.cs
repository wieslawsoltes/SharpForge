// langversion 14: expect CS8652 at 167 "outer"
// preview: csharplang/proposals/csharp-15.0/labeled-break-continue.md revision 1 commit 412dc3023500
class C
{
    void M()
    {
        outer: while (true) { break outer; }
    }
}
