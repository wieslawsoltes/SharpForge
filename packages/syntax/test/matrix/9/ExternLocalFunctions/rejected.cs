// langversion 8: expect CS8400 at 44 "extern"
class C
{
    void M()
    {
        static extern int Native(int x);
    }
}
