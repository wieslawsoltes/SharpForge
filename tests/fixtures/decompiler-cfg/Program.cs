using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var observations = new List<object>();
foreach (var method in typeof(NativeCases).GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
    .OrderBy(method => method.MetadataToken))
{
    var body = method.GetMethodBody()!;
    observations.Add(new {
        name = method.Name,
        token = method.MetadataToken,
        code = Convert.ToBase64String(body.GetILAsByteArray()!),
        clauses = body.ExceptionHandlingClauses.Select(clause => new {
            flags = (int)clause.Flags,
            start = clause.TryOffset,
            end = clause.TryOffset + clause.TryLength,
            target = clause.HandlerOffset,
            handlerEnd = clause.HandlerOffset + clause.HandlerLength,
            filterOffset = clause.Flags == ExceptionHandlingClauseOptions.Filter ? clause.FilterOffset : (int?)null,
        }).ToArray(),
    });
}
var filterResult = NativeCases.FilterFinally(0);
var finallyResult = NativeCases.Finally(3);
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription,
    methods = observations,
    filterResult,
    finallyResult,
    finalizers = NativeCases.Finalizers,
}));

public static class NativeCases
{
    public static int Finalizers;

    public static int Diamond(int value)
    {
        if (value > 0) return 1;
        return 2;
    }

    public static int Loop(int count)
    {
        var sum = 0;
        while (count-- > 0) sum += count;
        return sum;
    }

    public static int Switch(int value)
    {
        switch (value)
        {
            case 0: return 11;
            case 1: return 37;
            case 2: return 19;
            case 3: return 43;
            case 4: return 23;
            case 5: return 5;
            default: return -1;
        }
    }

    public static int Finally(int value)
    {
        try { return value + 1; }
        finally { Finalizers++; }
    }

    public static int FilterFinally(int value)
    {
        var result = 0;
        try
        {
            try
            {
                if (value == 0) throw new InvalidOperationException();
                result = 10 / value;
            }
            catch (InvalidOperationException) when (value == 0) { result = 42; }
        }
        finally { result += 2; }
        return result;
    }
}
