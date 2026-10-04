using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

public static class Fixture
{
    public static int Value(int seed)
    {
        int root = seed;
        {
            string nested = "scope";
            var items = new List<int> { nested.Length };
            root += items[0];
            {
                int[] values = [root];
                root = values[0];
            }
        }
        {
            long sibling = 7;
            root += (int)sibling;
        }
        return root;
    }
}

internal static class Program
{
    static void Main()
    {
        var path = typeof(Program).Assembly.Location;
        using var pe = new PEReader(File.OpenRead(path));
        var metadata = pe.GetMetadataReader();
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.ChangeExtension(path, ".pdb")));
        var pdb = provider.GetMetadataReader();
        var method = typeof(Fixture).GetMethod("Value")!.MetadataToken;
        var handle = MetadataTokens.MethodDefinitionHandle(method & 0xffffff);
        var body = pe.GetMethodBody(metadata.GetMethodDefinition(handle).RelativeVirtualAddress);
        var types = metadata.GetStandaloneSignature(body.LocalSignature).DecodeLocalSignature(new TypeNames(), (object?)null);
        object ReadScope(LocalScopeHandle scopeHandle)
        {
            var scope = pdb.GetLocalScope(scopeHandle);
            var children = new List<object>();
            var enumerator = scope.GetChildren();
            while (enumerator.MoveNext()) children.Add(ReadScope(enumerator.Current));
            return new {
                id = MetadataTokens.GetRowNumber(scopeHandle), start = scope.StartOffset, end = scope.EndOffset,
                importScope = MetadataTokens.GetRowNumber(scope.ImportScope),
                locals = scope.GetLocalVariables().Select(localHandle => {
                    var local = pdb.GetLocalVariable(localHandle);
                    return new { id = MetadataTokens.GetRowNumber(localHandle), index = local.Index,
                        name = pdb.GetString(local.Name), attributes = (int)local.Attributes,
                        compilerGenerated = local.Attributes.HasFlag(LocalVariableAttributes.DebuggerHidden), typeName = types[local.Index] };
                }).ToArray(),
                constantIds = scope.GetLocalConstants().Select(h => MetadataTokens.GetRowNumber(h)).ToArray(), children
            };
        }
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(), method, result = Fixture.Value(2),
            roots = new[] { ReadScope(pdb.GetLocalScopes(handle).First()) }
        }));
    }
}

sealed class TypeNames : ISignatureTypeProvider<string, object?>
{
    public string GetArrayType(string element, ArrayShape shape) => element + "[" + new string(',', shape.Rank - 1) + "]";
    public string GetByReferenceType(string element) => element + "&";
    public string GetFunctionPointerType(MethodSignature<string> signature) => throw new NotSupportedException();
    public string GetGenericInstantiation(string type, ImmutableArray<string> arguments) => type + "<" + string.Join(", ", arguments) + ">";
    public string GetGenericMethodParameter(object? context, int index) => "!!" + index;
    public string GetGenericTypeParameter(object? context, int index) => "!" + index;
    public string GetModifiedType(string modifier, string element, bool required) => element + (required ? " modreq(" : " modopt(") + modifier + ")";
    public string GetPinnedType(string element) => element + " pinned";
    public string GetPointerType(string element) => element + "*";
    public string GetPrimitiveType(PrimitiveTypeCode code) => code switch {
        PrimitiveTypeCode.Int32 => "int", PrimitiveTypeCode.Int64 => "long", PrimitiveTypeCode.String => "string",
        _ => throw new NotSupportedException(code.ToString())
    };
    public string GetSZArrayType(string element) => element + "[]";
    public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawKind) => throw new NotSupportedException();
    public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawKind)
    {
        var type = reader.GetTypeReference(handle);
        return reader.GetString(type.Namespace) + "." + reader.GetString(type.Name);
    }
    public string GetTypeFromSpecification(MetadataReader reader, object? context, TypeSpecificationHandle handle, byte rawKind) =>
        reader.GetTypeSpecification(handle).DecodeSignature(this, context);
}
