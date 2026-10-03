// preview: csharplang/proposals/csharp-15.0/collection-expression-arguments.md revision 1 commit 412dc3023500
class C
{
    void M()
    {
        object a = [with(4), 1];
    }
}
