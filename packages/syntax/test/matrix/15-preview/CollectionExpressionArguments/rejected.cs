// langversion 14: expect CS8652 at 49 "with"
class C
{
    void M()
    {
        object a = [with(4), 1];
    }
}
