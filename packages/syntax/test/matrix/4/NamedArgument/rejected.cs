// langversion 3: expect CS8024 at 39 "count:"
class C
{
    void M()
    {
        F(count: 1);
    }
}
