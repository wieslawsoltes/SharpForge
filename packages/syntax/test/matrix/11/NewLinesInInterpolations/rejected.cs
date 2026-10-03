// langversion 10: expect CS8936 at 48 "$\"{\n            x}\""
class C
{
    void M()
    {
        string s = $"{
            x}";
    }
}
