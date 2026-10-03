unsafe class C
{
    void M()
    {
        int* p = stackalloc int[] { 1, 2 };
    }
}
