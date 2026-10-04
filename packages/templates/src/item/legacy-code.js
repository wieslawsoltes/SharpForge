import { component, winuiUsings as X } from '../common.js';

export const legacyCodeItems = {
'class': n => ({
  body:`public class ${n}
{
    public int Value { get; set; }
}`
}
),
'partial-class': n => ({
  body:`public partial class ${n}
{
    public int Value { get; set; }
}`,
  second:`public partial class ${n}
{
    public int GetValue()
    {
        return Value;
    }
}`
}
),
'static-class': n => ({
  body:`public static class ${n}
{
    public static int Add(int left, int right)
    {
        return left + right;
    }
}`
}
),
'disposable-class': n => ({
  usings:'using System;\n',
  body:`public class ${n} : IDisposable
{
    public bool IsDisposed { get; private set; }
    public void Dispose()
    {
        IsDisposed = true;
    }
}`
}
),
'view-model': n => ({
  body:`public class ${n}
{
    public string Title { get; set; } = "New view";
    public int Count { get; set; }
}`
}
),
};
