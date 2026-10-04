using System;

namespace AttributeExport;

[AttributeUsage(AttributeTargets.All, Inherited = false)]
public sealed class TagAttribute : Attribute
{
    public readonly string Value;
    public TagAttribute(string value) { Value = value; }
}

[AttributeUsage(AttributeTargets.Property, Inherited = false)]
public sealed class PropertyOnlyAttribute : Attribute
{
    public readonly string Value;
    public PropertyOnlyAttribute(string value) { Value = value; }
}

public static class Extensions
{
    extension([Tag("receiver")] string text)
    {
        [PropertyOnly("expression")]
        public int Length => text.Length;

        [PropertyOnly("accessors")]
        public int Writable
        {
            [Tag("getter")]
            get => text.Length;
            [param: Tag("value")]
            set { }
        }

        [Tag("method")]
        [return: Tag("return")]
        public int Add([Tag("argument")] int offset = 1) => text.Length + offset;
    }

    extension<[Tag("blockType")] T>([Tag("staticReceiver")] T[] values)
    {
        [PropertyOnly("staticProperty")]
        public static int Size => 9;
    }
}
