// langversion 14: expect CS8652 at 165 "this"
// preview: csharplang/proposals/csharp-15.0/extension-indexers.md revision 1 commit 412dc3023500
static class E
{
    extension(string s)
    {
        public char this[int i] => s[i];
    }
}
