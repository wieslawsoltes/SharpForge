// langversion 9: expect CS8773 at 64 "(x, int y) = t"
class C
{
    void M((int, int) t)
    {
        int x;
        (x, int y) = t;
    }
}
