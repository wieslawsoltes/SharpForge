// langversion 5: expect CS8026 at 48 "$\"{x}\""
class C
{
    void M()
    {
        string s = $"{x}";
    }
}
