[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: CLSCompliant(true), ComVisible(false)]
[module: Marker]

[Serializable]
[Obsolete("old", error: true)]
[System.Diagnostics.Conditional("DEBUG"), Custom(1, 2, Name = "n", Other = typeof(int))]
[type: Flagged]
class Attributed<[TypeParam] T>
{
    [field: NonSerialized]
    [Browsable(false)]
    public int Field;

    [property: Description("p")]
    public int Property { [method: Trace] get; [param: NotNull] set; }

    [method: Custom]
    [return: MarshalAs(UnmanagedType.Bool)]
    public bool Method([In, Out] ref int value, [param: Optional] int other, [CallerMemberName] string caller = "") { return true; }

    [event: Custom]
    public event System.EventHandler Changed;

    [Generic<int>]
    void Local() { }
}
enum E { [Description("first")] A, [EnumMember(Value = "b")] B }
[return: NotNull] delegate string D([NotNull] string value);
