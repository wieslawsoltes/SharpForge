// The original C# 14 proposal's attribute name. The fixture does not apply this attribute in source;
// one metadata test redirects the actual marker constructor reference here to exercise that earlier contract.
namespace System.Runtime.CompilerServices;

public sealed class ExtensionMarkerNameAttribute : System.Attribute
{
    public ExtensionMarkerNameAttribute(string name) => Name = name;
    public string Name { get; }
}
