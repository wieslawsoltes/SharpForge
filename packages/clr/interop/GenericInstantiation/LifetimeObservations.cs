using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Loader;

namespace GenericInstantiationOracle;

internal sealed record LifetimeProbe(object observations, WeakReference[] contexts);

internal static class LifetimeObservations
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static LifetimeProbe Observe(TypeObservations types, string fixturePath)
    {
        var first = new AssemblyLoadContext("GenericInstantiationA", isCollectible: true);
        var second = new AssemblyLoadContext("GenericInstantiationB", isCollectible: true);
        var firstUnloading = 0;
        var secondUnloading = 0;
        first.Unloading += _ => firstUnloading++;
        second.Unloading += _ => secondUnloading++;
        try
        {
            var firstAssembly = first.LoadFromAssemblyPath(fixturePath);
            var secondAssembly = second.LoadFromAssemblyPath(fixturePath);
            types.Register(firstAssembly, "fixture", "a");
            types.Register(secondAssembly, "fixture", "b");
            var token = typeof(Fixture.Box<>).MetadataToken;
            var firstDefinition = firstAssembly.ManifestModule.ResolveType(token);
            var secondDefinition = secondAssembly.ManifestModule.ResolveType(token);
            var argument = firstAssembly.ManifestModule.ResolveType(typeof(Fixture.Other<>).MetadataToken).MakeGenericType(typeof(int));
            var cases = new CaseObservations(types);
            cases.Instantiate("lifetime-default-box", typeof(Fixture.Box<>), [typeof(int)]);
            cases.Instantiate("lifetime-a-box", firstDefinition, [typeof(int)]);
            cases.Instantiate("lifetime-b-box", secondDefinition, [typeof(int)]);
            cases.Same("lifetime-default-box", "lifetime-a-box");
            cases.Same("lifetime-a-box", "lifetime-b-box");
            cases.Instantiate("lifetime-default-collectible-argument", typeof(Fixture.Box<>), [argument]);
            cases.Instantiate("lifetime-default-collectible-repeat", typeof(Fixture.Box<>), [argument]);
            cases.Same("lifetime-default-collectible-argument", "lifetime-default-collectible-repeat");
            var retained = firstDefinition.MakeGenericType(typeof(int));
            first.Unload();
            second.Unload();
            cases.Add("lifetime-retained-after-unload", new { op = "retained", of = "lifetime-a-box" }, () => retained, "lifetime-canonical");
            cases.Instantiate("lifetime-reconstruct-after-unload", firstDefinition, [typeof(int)], "lifetime-canonical");
            cases.Same("lifetime-a-box", "lifetime-retained-after-unload");
            cases.Same("lifetime-a-box", "lifetime-reconstruct-after-unload");
            return new LifetimeProbe(new
            {
                contexts = new[] { new { id = "a", collectible = first.IsCollectible }, new { id = "b", collectible = second.IsCollectible } },
                firstUnloadEvents = firstUnloading,
                secondUnloadEvents = secondUnloading,
                cases = cases.Cases,
                identities = cases.Identities,
                scope = "Canonical identity and retained descriptors after Unload; collection timing is a separate observation."
            }, [new WeakReference(first), new WeakReference(second)]);
        }
        finally
        {
            if (firstUnloading == 0) first.Unload();
            if (secondUnloading == 0) second.Unload();
        }
    }

    public static object Capture(TypeObservations types, string fixturePath)
    {
        var probe = Observe(types, Path.GetFullPath(fixturePath));
        const int collectionRounds = 8;
        for (var round = 0; round < collectionRounds; round++)
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
        }
        return new
        {
            reference = probe.observations,
            collection = new
            {
                rounds = collectionRounds,
                firstContextCollected = !probe.contexts[0].IsAlive,
                secondContextCollected = !probe.contexts[1].IsAlive,
                comparison = "observation-only",
                scope = "Bounded WeakReference observation of ALC objects; no GC deadline, cache-size or native-memory parity claim."
            }
        };
    }
}

