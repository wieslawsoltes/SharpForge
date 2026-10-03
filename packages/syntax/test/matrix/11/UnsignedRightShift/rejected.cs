// langversion 10: expect CS8936 at 50 "a >>> 1"
class C
{
    void M(int a)
    {
        int x = a >>> 1;
    }
}
