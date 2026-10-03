// langversion 7.1: expect CS8302 at 45 "0x_FF"
class C
{
    void M()
    {
        int x = 0x_FF;
    }
}
