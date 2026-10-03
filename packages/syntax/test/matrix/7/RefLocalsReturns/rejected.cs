// langversion 6: expect CS8059 at 37 "ref"
class C
{
    void M()
    {
        ref int r = ref field;
    }
}
