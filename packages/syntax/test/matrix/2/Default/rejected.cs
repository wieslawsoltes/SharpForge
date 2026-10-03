// langversion 1: expect CS8022 at 48 "default"
class C
{
    void M()
    {
        int zero = default(int);
    }
}
