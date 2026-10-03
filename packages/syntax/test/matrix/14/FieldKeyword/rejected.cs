// langversion 13: expect an older meaning: an identifier named field
class C
{
    public int Value { get => field; set => field = value < 0 ? 0 : value; }
}
