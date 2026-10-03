class C
{
    public int Value { get => field; set => field = value < 0 ? 0 : value; }
}
