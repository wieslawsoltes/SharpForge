// langversion 7.3: expect CS8370 at 50 "switch"
class C
{
    void M()
    {
        object r = o switch { 1 => 2 };
    }
}
