// langversion 10: expect CS8967 at 65 "}"
class C
{
    void M()
    {
        string s = $"{
            x}";
    }
}
