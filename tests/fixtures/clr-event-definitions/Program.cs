using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(Events<>).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var events = new[] { typeof(Base), typeof(Events<>), typeof(IChanged), typeof(Pair) }
    .SelectMany(type => type.GetEvents(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static |
        BindingFlags.Instance | BindingFlags.DeclaredOnly)).OrderBy(item => item.MetadataToken).Select(item =>
    {
        var definition = metadata.GetEventDefinition(MetadataTokens.EventDefinitionHandle(item.MetadataToken & 0xffffff));
        return new { token = item.MetadataToken, owner = item.DeclaringType!.MetadataToken, name = item.Name,
            flags = (int)item.Attributes, eventType = MetadataTokens.GetToken(definition.Type),
            add = item.GetAddMethod(true)?.MetadataToken, remove = item.GetRemoveMethod(true)?.MetadataToken,
            raise = item.GetRaiseMethod(true)?.MetadataToken,
            others = definition.GetAccessors().Others.Select(handle => MetadataTokens.GetToken(handle)) };
    });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, events }));

public class Base { public virtual event Action? Changed; }
public class Events<T> : Base, IChanged
{
    public override event Action? Changed;
    public static event EventHandler? Static;
    public event Action<T>? Generic;
    protected event EventHandler? Protected;
    event Action? IChanged.Changed { add { } remove { } }
}
public interface IChanged { event Action? Changed; }
public struct Pair { public event Action? Changed; }
