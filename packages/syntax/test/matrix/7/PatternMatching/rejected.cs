// langversion 6: expect CS8059 at 51 "int"
class C
{
    void M()
    {
        bool b = o is int i;
    }
}
