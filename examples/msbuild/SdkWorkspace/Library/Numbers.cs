namespace NativeExample;
public static class Numbers
{
    public static int Sum<T>(IEnumerable<T> values, Func<T, int> select) => values.Sum(select);
}
