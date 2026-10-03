class C
{
    int M()
    {
        static int Twice(int x) { return x * 2; }
        return Twice(1);
    }
}
