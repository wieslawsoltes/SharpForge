// langversion 7.3: expect CS8370 at 36 "static"
class C
{
    int M()
    {
        static int Twice(int x) { return x * 2; }
        return Twice(1);
    }
}
