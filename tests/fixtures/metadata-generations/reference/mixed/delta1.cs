public static class MixedFixture
{
    public static string Old() => "first update λ";
    public static int Stable(int value) => value;
        public static int AddedField;
    public static string Added() => "first insert";
    
}