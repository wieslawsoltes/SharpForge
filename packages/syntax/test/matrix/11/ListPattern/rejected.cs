// langversion 10: expect CS8936 at 51 "[1, 2]"
class C
{
    void M()
    {
        bool b = o is [1, 2];
    }
}
