using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed class Types : ISignatureTypeProvider<string, object?>
{
    public string GetArrayType(string element, ArrayShape shape) {
        // Omitted shape vectors are different from explicit zero bounds/sizes.
        if (shape.Sizes.IsEmpty && shape.LowerBounds.IsEmpty)
            return element + "[" + (shape.Rank == 1 ? "*" : new string(',', shape.Rank - 1)) + "]";
        string sizes = string.Join(",", shape.Sizes.Select(value => value.ToString(CultureInfo.InvariantCulture)));
        string lower = string.Join(",", shape.LowerBounds.Select(value => value.ToString(CultureInfo.InvariantCulture)));
        return element + FormattableString.Invariant($"[rank={shape.Rank};sizes=({sizes});lower=({lower})]");
    }
    public string GetByReferenceType(string element) => element + "&";
    // Preserve the calling convention/flags and the vararg boundary, including inside other types.
    public string GetFunctionPointerType(MethodSignature<string> signature) => FormattableString.Invariant(
        $"method[header=0x{signature.Header.RawValue:X2};generic={signature.GenericParameterCount};required={signature.RequiredParameterCount}] {signature.ReturnType} *({string.Join(",", signature.ParameterTypes)})");
    public string GetGenericInstantiation(string generic, ImmutableArray<string> arguments) => generic + "<" + string.Join(",", arguments) + ">";
    public string GetGenericMethodParameter(object? context, int index) => "!!" + index;
    public string GetGenericTypeParameter(object? context, int index) => "!" + index;
    public string GetModifiedType(string modifier, string type, bool required) => type + (required ? " modreq(" : " modopt(") + modifier + ")";
    public string GetPinnedType(string element) => element + " pinned";
    public string GetPointerType(string element) => element + "*";
    public string GetPrimitiveType(PrimitiveTypeCode code) => code switch {
        PrimitiveTypeCode.Void => "System.Void", PrimitiveTypeCode.Boolean => "System.Boolean", PrimitiveTypeCode.Char => "System.Char",
        PrimitiveTypeCode.SByte => "System.SByte", PrimitiveTypeCode.Byte => "System.Byte", PrimitiveTypeCode.Int16 => "System.Int16", PrimitiveTypeCode.UInt16 => "System.UInt16",
        PrimitiveTypeCode.Int32 => "System.Int32", PrimitiveTypeCode.UInt32 => "System.UInt32", PrimitiveTypeCode.Int64 => "System.Int64", PrimitiveTypeCode.UInt64 => "System.UInt64",
        PrimitiveTypeCode.Single => "System.Single", PrimitiveTypeCode.Double => "System.Double", PrimitiveTypeCode.String => "System.String", PrimitiveTypeCode.Object => "System.Object",
        PrimitiveTypeCode.IntPtr => "System.IntPtr", PrimitiveTypeCode.UIntPtr => "System.UIntPtr", PrimitiveTypeCode.TypedReference => "System.TypedReference", _ => throw new BadImageFormatException("Unknown primitive type") };
    public string GetSZArrayType(string element) => element + "[]";
    public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte raw) {
        var type = reader.GetTypeDefinition(handle); var declaring = type.GetDeclaringType();
        return declaring.IsNil ? Qualify(reader.GetString(type.Namespace), reader.GetString(type.Name)) : GetTypeFromDefinition(reader, declaring, 0) + "+" + reader.GetString(type.Name);
    }
    public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte raw) {
        var type = reader.GetTypeReference(handle);
        return type.ResolutionScope.Kind == HandleKind.TypeReference ? GetTypeFromReference(reader, (TypeReferenceHandle)type.ResolutionScope, 0) + "+" + reader.GetString(type.Name) : Qualify(reader.GetString(type.Namespace), reader.GetString(type.Name));
    }
    public string GetTypeFromSpecification(MetadataReader reader, object? context, TypeSpecificationHandle handle, byte raw) => reader.GetTypeSpecification(handle).DecodeSignature(this, context);
    public string Entity(MetadataReader reader, EntityHandle handle) => handle.Kind switch {
        HandleKind.TypeDefinition => GetTypeFromDefinition(reader, (TypeDefinitionHandle)handle, 0),
        HandleKind.TypeReference => GetTypeFromReference(reader, (TypeReferenceHandle)handle, 0),
        HandleKind.TypeSpecification => GetTypeFromSpecification(reader, null, (TypeSpecificationHandle)handle, 0),
        _ => throw new BadImageFormatException("Expected a type handle") };
    private static string Qualify(string ns, string name) => ns.Length == 0 ? name : ns + "." + name;
}

internal static class Program
{
    private static bool PublicType(MetadataReader reader, TypeDefinitionHandle handle) {
        var type = reader.GetTypeDefinition(handle);
        var visibility = type.Attributes & TypeAttributes.VisibilityMask;
        return visibility == TypeAttributes.Public || visibility == TypeAttributes.NestedPublic && PublicType(reader, type.GetDeclaringType());
    }
    private static bool PublicMethod(MetadataReader reader, MethodDefinitionHandle handle) => !handle.IsNil && (reader.GetMethodDefinition(handle).Attributes & MethodAttributes.MemberAccessMask) == MethodAttributes.Public;
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static int Main(string[] args) {
        try {
            if (args.Length < 2 || Environment.Version.ToString() != "10.0.5") throw new ArgumentException("Expected mode, output and optional metadata inputs on pinned CoreCLR 10.0.5");
            object output = args[0] switch {
                "metadata" => Metadata(args.Skip(2).ToArray()),
                "ecma" => Ecma(),
                "diagnostics" => Diagnostics(args[2]),
                _ => throw new ArgumentException("Unknown metadata extractor mode") };
            File.WriteAllText(args[1], JsonSerializer.Serialize(output)); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static object Metadata(string[] paths) {
        if (paths.Length == 0 || paths.Length > 512) throw new ArgumentException("Metadata input count out of bounds");
        var provider = new Types(); var files = new List<object>(); var rows = new List<object>();
        foreach (string path in paths.Order(StringComparer.Ordinal)) {
            byte[] bytes = File.ReadAllBytes(path);
            using var stream = new MemoryStream(bytes); using var pe = new PEReader(stream);
            if (!pe.HasMetadata) throw new BadImageFormatException("Input has no managed metadata: " + path);
            // Raw WinMD identities are required, without CLR projection hiding its actual API rows.
            var reader = pe.GetMetadataReader(MetadataReaderOptions.None);
            string assembly = reader.IsAssembly ? reader.GetString(reader.GetAssemblyDefinition().Name) : Path.GetFileNameWithoutExtension(path);
            files.Add(new { name = Path.GetFileName(path), assembly, sha256 = Hash(bytes), metadataVersion = reader.MetadataVersion });
            foreach (var handle in reader.TypeDefinitions) {
                if (!PublicType(reader, handle)) continue;
                var type = reader.GetTypeDefinition(handle); string owner = provider.GetTypeFromDefinition(reader, handle, 0);
                rows.Add(new { assembly, owner, kind = "type", name = owner, isStatic = false, result = owner, parameters = Array.Empty<string>(), genericArity = type.GetGenericParameters().Count, signature = owner });
                foreach (var methodHandle in type.GetMethods()) {
                    if (!PublicMethod(reader, methodHandle)) continue;
                    var method = reader.GetMethodDefinition(methodHandle); var signature = method.DecodeSignature(provider, (object?)null); string name = reader.GetString(method.Name);
                    bool isStatic = (method.Attributes & MethodAttributes.Static) != 0;
                    int signatureHeader = signature.Header.RawValue;
                    int ordinaryHeader = (isStatic ? 0 : 0x20) | (signature.GenericParameterCount > 0 ? 0x10 : 0);
                    // Keep ordinary gap identities stable; retain every non-default MethodDefSig header bit (II.23.2.1).
                    string headerSuffix = signatureHeader == ordinaryHeader ? "" : FormattableString.Invariant($" [header=0x{signatureHeader:X2}]");
                    rows.Add(new { assembly, owner, kind = "method", name, isStatic, result = signature.ReturnType, parameters = signature.ParameterTypes.ToArray(), genericArity = signature.GenericParameterCount, signatureHeader,
                        signature = owner + "::" + name + "``" + signature.GenericParameterCount + "(" + string.Join(",", signature.ParameterTypes) + "):" + signature.ReturnType + (isStatic ? " static" : " instance") + headerSuffix });
                }
                foreach (var fieldHandle in type.GetFields()) {
                    var field = reader.GetFieldDefinition(fieldHandle); if ((field.Attributes & FieldAttributes.FieldAccessMask) != FieldAttributes.Public) continue;
                    string name = reader.GetString(field.Name), value = field.DecodeSignature(provider, (object?)null); bool isStatic = (field.Attributes & FieldAttributes.Static) != 0;
                    rows.Add(new { assembly, owner, kind = "field", name, isStatic, result = value, parameters = Array.Empty<string>(), genericArity = 0, signature = owner + "::" + name + ":" + value + (isStatic ? " static" : " instance") });
                }
                foreach (var propertyHandle in type.GetProperties()) {
                    var property = reader.GetPropertyDefinition(propertyHandle); var accessors = property.GetAccessors();
                    bool get = PublicMethod(reader, accessors.Getter), set = PublicMethod(reader, accessors.Setter); if (!get && !set) continue;
                    var signature = property.DecodeSignature(provider, (object?)null); string name = reader.GetString(property.Name); bool isStatic = !signature.Header.IsInstance;
                    rows.Add(new { assembly, owner, kind = "property", name, isStatic, result = signature.ReturnType, parameters = signature.ParameterTypes.ToArray(), genericArity = 0, get, set,
                        signature = owner + "::" + name + "[" + string.Join(",", signature.ParameterTypes) + "]:" + signature.ReturnType + (get ? " get" : "") + (set ? " set" : "") + (isStatic ? " static" : " instance") });
                }
                foreach (var eventHandle in type.GetEvents()) {
                    var entry = reader.GetEventDefinition(eventHandle); var accessors = entry.GetAccessors();
                    if (!PublicMethod(reader, accessors.Adder) && !PublicMethod(reader, accessors.Remover)) continue;
                    string name = reader.GetString(entry.Name), value = provider.Entity(reader, entry.Type);
                    bool isStatic = (reader.GetMethodDefinition(accessors.Adder.IsNil ? accessors.Remover : accessors.Adder).Attributes & MethodAttributes.Static) != 0;
                    rows.Add(new { assembly, owner, kind = "event", name, isStatic, result = value, parameters = Array.Empty<string>(), genericArity = 0, signature = owner + "::" + name + ":" + value + (isStatic ? " static" : " instance") });
                }
            }
        }
        return new { schemaVersion = 1, runtime = Environment.Version.ToString(), files, rows };
    }
    private static object Ecma() => new {
        schemaVersion = 1, runtime = Environment.Version.ToString(),
        opcodes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static).Where(field => field.FieldType == typeof(OpCode)).Select(field => (OpCode)field.GetValue(null)!).OrderBy(code => unchecked((ushort)code.Value)).Select(code => new { name = code.Name, value = unchecked((ushort)code.Value), operandType = code.OperandType.ToString(), opcodeType = code.OpCodeType.ToString(), stackPop = code.StackBehaviourPop.ToString(), stackPush = code.StackBehaviourPush.ToString() }).ToArray(),
        tables = Enum.GetValues<TableIndex>().Select(value => new { name = value.ToString(), value = (int)value, standard = (int)value <= 44 ? "ECMA-335-II.22" : "Portable PDB" }).ToArray()
    };
    private static object Diagnostics(string compilerPath) {
        var assembly = Assembly.LoadFrom(compilerPath);
        var type = assembly.GetType("Microsoft.CodeAnalysis.CSharp.ErrorCode", throwOnError: true)!;
        return new { schemaVersion = 1, assembly = assembly.FullName, sha256 = Hash(File.ReadAllBytes(compilerPath)), rows = Enum.GetNames(type).Select(name => new { name, value = Convert.ToInt32(Enum.Parse(type, name)) }).Where(row => row.value > 0).OrderBy(row => row.value).ToArray() };
    }
}
