// langversion 7.1: expect CS8302 at 45 "0"
class C
{
    void M()
    {
        int x = 0x_FF;
    }
}
