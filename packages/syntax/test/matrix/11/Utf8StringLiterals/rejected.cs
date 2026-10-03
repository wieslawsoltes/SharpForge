// langversion 10: expect CS8936 at 48 "\"text\"u8"
class C
{
    void M()
    {
        object s = "text"u8;
    }
}
