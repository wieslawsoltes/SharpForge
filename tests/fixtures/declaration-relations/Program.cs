using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Static |
    BindingFlags.Public | BindingFlags.NonPublic;
var module = typeof(Fixture.Root).Module;
var types = module.Assembly.GetTypes().Where(type => type.Namespace == "Fixture").OrderBy(type => type.MetadataToken).ToArray();
var methods = types.Where(type => !type.IsInterface).SelectMany(type => type.GetMethods(flags))
    .OrderBy(method => method.MetadataToken).ToArray();
var entries = new List<RelationObservation>();
foreach (var source in methods.Where(method => method.IsVirtual))
{
    foreach (var target in methods.Where(method => method.IsVirtual && method != source &&
        method.DeclaringType != source.DeclaringType && method.DeclaringType!.IsAssignableFrom(source.DeclaringType) &&
        method.GetBaseDefinition() == source.GetBaseDefinition()))
    {
        entries.Add(new RelationObservation { relation = "overridden-by", sourceToken = source.MetadataToken,
            targetToken = target.MetadataToken, implementingTypeToken = source.DeclaringType!.MetadataToken });
    }
}
foreach (var type in types.Where(type => !type.IsInterface))
{
    foreach (var contract in type.GetInterfaces().Where(contract => contract.Module == module))
    {
        var map = type.GetInterfaceMap(contract);
        for (var index = 0; index < map.InterfaceMethods.Length; index++)
        {
            var target = map.TargetMethods[index];
            if (target.Module != module) continue;
            entries.Add(new RelationObservation { relation = "implemented-by", sourceToken = target.MetadataToken,
                targetToken = map.InterfaceMethods[index].MetadataToken, implementingTypeToken = type.MetadataToken });
        }
    }
}
Console.WriteLine(JsonSerializer.Serialize(new Capture { runtime = RuntimeInformation.FrameworkDescription, entries = entries }));

public sealed class Capture
{
    public string runtime { get; set; } = "";
    public List<RelationObservation> entries { get; set; } = new();
}

public sealed class RelationObservation
{
    public string relation { get; set; } = "";
    public int sourceToken { get; set; }
    public int targetToken { get; set; }
    public int implementingTypeToken { get; set; }
}

namespace Fixture
{
    public interface IContract
    {
        int M(int value);
        int Other(int value);
        T Identity<T>(T value);
    }
    public interface IChild : IContract { }
    public class Root : IContract
    {
        public virtual int M(int value) => value;
        public virtual int Other(int value) => value;
        public virtual T Identity<T>(T value) => value;
    }
    public class Middle : Root, IContract
    {
        public override int M(int value) => value + 1;
        int IContract.Other(int value) => value + 2;
        public override T Identity<T>(T value) => value;
    }
    public class Hidden : Middle { public new virtual int M(int value) => value + 3; }
    public class Leaf : Middle { public sealed override int M(int value) => value + 4; }
    public class Reimplemented : Hidden, IChild { public new virtual int M(int value) => value + 5; }
}
