// langversion 5: expect CS8026 at 49 "?"
class C
{
    void M()
    {
        object o = a?.b;
    }
}
