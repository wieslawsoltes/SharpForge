using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using GenericInstantiationOracle;

namespace GenericClosureOracle;

internal static class MetadataInventory
{
    private static int Token(EntityHandle handle) => handle.IsNil ? 0 : MetadataTokens.GetToken(handle);

    public static object Read(string path)
    {
        using var stream = File.OpenRead(path);
        using var pe = new PEReader(stream);
        var reader = pe.GetMetadataReader();
        var assembly = reader.GetAssemblyDefinition();
        var module = reader.GetModuleDefinition();
        return new
        {
            source = "System.Reflection.Metadata", metadataVersion = reader.MetadataVersion,
            assembly = new { name = reader.GetString(assembly.Name), version = assembly.Version.ToString(),
                culture = reader.GetString(assembly.Culture), publicKey = Convert.ToHexString(reader.GetBlobBytes(assembly.PublicKey)),
                flags = (int)assembly.Flags },
            module = new { name = reader.GetString(module.Name), mvid = reader.GetGuid(module.Mvid).ToString() },
            typeDefinitions = reader.TypeDefinitions.Select(handle =>
            {
                var type = reader.GetTypeDefinition(handle);
                return new { token = Token(handle), name = reader.GetString(type.Name), @namespace = reader.GetString(type.Namespace),
                    attributes = (int)type.Attributes, extendsToken = Token(type.BaseType), declaringTypeToken = Token(type.GetDeclaringType()),
                    genericParameters = type.GetGenericParameters().Select(item => Token(item)).ToArray(),
                    interfaces = type.GetInterfaceImplementations().Select(item => new { token = Token(item),
                        interfaceToken = Token(reader.GetInterfaceImplementation(item).Interface) }).ToArray() };
            }).ToArray(),
            genericParameters = Enumerable.Range(1, reader.GetTableRowCount(TableIndex.GenericParam)).Select(row =>
            {
                var handle = MetadataTokens.GenericParameterHandle(row);
                var parameter = reader.GetGenericParameter(handle);
                return new { token = Token(handle), ownerToken = Token(parameter.Parent), index = parameter.Index,
                    name = reader.GetString(parameter.Name), attributes = (int)parameter.Attributes,
                    constraints = parameter.GetConstraints().Select(item => Token(reader.GetGenericParameterConstraint(item).Type)).ToArray() };
            }).ToArray(),
            typeReferences = reader.TypeReferences.Select(handle =>
            {
                var type = reader.GetTypeReference(handle);
                return new { token = Token(handle), name = reader.GetString(type.Name), @namespace = reader.GetString(type.Namespace),
                    resolutionScopeToken = Token(type.ResolutionScope) };
            }).ToArray(),
            assemblyReferences = reader.AssemblyReferences.Select(handle =>
            {
                var reference = reader.GetAssemblyReference(handle);
                return new { token = Token(handle), name = reader.GetString(reference.Name), version = reference.Version.ToString(),
                    culture = reader.GetString(reference.Culture), flags = (int)reference.Flags,
                    publicKeyOrToken = Convert.ToHexString(reader.GetBlobBytes(reference.PublicKeyOrToken)) };
            }).ToArray(),
            typeSpecifications = SignatureObservations.Read(path)
        };
    }
}
