#nullable enable
using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

// Independent PEReader/SRM observation only: input assemblies are never loaded or executed.
internal static class Program
{
    private const int MaxImageBytes = 256 * 1024 * 1024;
    private const int MaxMethods = 262144;
    private const int MaxDebugEntries = 65536;

    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: PEInspectionObserver <PE/CLI image>");
            return 2;
        }
        try
        {
            object result = Observe(args[0]);
            Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            return 0;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException
            or BadImageFormatException or ArgumentException or OverflowException)
        {
            Console.Error.WriteLine($"{error.GetType().FullName}: {error.Message}");
            return 1;
        }
    }

    private static object Observe(string path)
    {
        if (new FileInfo(path).Length > MaxImageBytes)
            throw new BadImageFormatException("Observer image byte limit exceeded.");
        byte[] bytes = File.ReadAllBytes(path);
        if (bytes.Length > MaxImageBytes)
            throw new BadImageFormatException("Observer image byte limit exceeded.");
        using var stream = new MemoryStream(bytes, writable: false);
        using var pe = new PEReader(stream);
        PEHeaders headers = pe.PEHeaders;
        _ = headers.PEHeader ?? throw new BadImageFormatException("Expected a PE optional header.");
        CorHeader cli = headers.CorHeader ?? throw new BadImageFormatException("Expected a CLI header.");
        MetadataReader metadata = pe.GetMetadataReader(MetadataReaderOptions.None);
        uint? signature = ReadManagedNativeSignature(pe, bytes, cli.ManagedNativeHeaderDirectory);
        return new
        {
            schemaVersion = 1,
            observer = new
            {
                name = "System.Reflection.Metadata.PEReader",
                runtime = RuntimeInformation.FrameworkDescription,
                os = RuntimeInformation.OSDescription,
                architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                metadataAssemblyVersion = typeof(PEReader).Assembly.GetName().Version?.ToString()
            },
            image = new { name = Path.GetFileName(path), bytes = bytes.Length, sha256 = Hash(bytes) },
            imageKind = ClassifyImage(cli, signature),
            headers = ObserveHeaders(headers, bytes),
            sections = ObserveSections(headers),
            directories = ObserveDirectories(headers, bytes),
            cli = ObserveCli(headers, bytes),
            managedNativeSignature = signature,
            debugDirectory = ObserveDebug(pe, bytes),
            strongName = ObserveStrongName(pe, bytes, metadata),
            methods = ObserveMethods(pe, metadata)
        };
    }

    private static object ObserveHeaders(PEHeaders headers, byte[] bytes)
    {
        CoffHeader coff = headers.CoffHeader;
        return new
        {
            dos = new
            {
                magic = BinaryPrimitives.ReadUInt16LittleEndian(Range(bytes, 0, 2)),
                peHeaderOffset = RawUInt32(bytes, 0x3c)
            },
            coff = new
            {
                machine = (ushort)coff.Machine,
                sectionCount = unchecked((ushort)coff.NumberOfSections),
                timestamp = UInt32(coff.TimeDateStamp),
                pointerToSymbolTable = UInt32(coff.PointerToSymbolTable),
                numberOfSymbols = UInt32(coff.NumberOfSymbols),
                optionalHeaderSize = unchecked((ushort)coff.SizeOfOptionalHeader),
                characteristics = (ushort)coff.Characteristics
            },
            optional = ObserveOptionalHeader(headers, bytes)
        };
    }

    private static object ObserveOptionalHeader(PEHeaders headers, byte[] bytes)
    {
        PEHeader header = headers.PEHeader!;
        bool wide = header.Magic == PEMagic.PE32Plus;
        int start = headers.PEHeaderStartOffset;
        return new
        {
            format = wide ? "PE32+" : "PE32",
            magic = (ushort)header.Magic,
            majorLinkerVersion = header.MajorLinkerVersion,
            minorLinkerVersion = header.MinorLinkerVersion,
            sizeOfCode = UInt32(header.SizeOfCode),
            sizeOfInitializedData = UInt32(header.SizeOfInitializedData),
            sizeOfUninitializedData = UInt32(header.SizeOfUninitializedData),
            addressOfEntryPoint = UInt32(header.AddressOfEntryPoint),
            baseOfCode = UInt32(header.BaseOfCode),
            baseOfData = wide ? (uint?)null : UInt32(header.BaseOfData),
            imageBase = Hex(header.ImageBase),
            sectionAlignment = UInt32(header.SectionAlignment),
            fileAlignment = UInt32(header.FileAlignment),
            majorOperatingSystemVersion = header.MajorOperatingSystemVersion,
            minorOperatingSystemVersion = header.MinorOperatingSystemVersion,
            majorImageVersion = header.MajorImageVersion,
            minorImageVersion = header.MinorImageVersion,
            majorSubsystemVersion = header.MajorSubsystemVersion,
            minorSubsystemVersion = header.MinorSubsystemVersion,
            // These two reserved scalar fields have no public PEHeader properties.
            win32VersionValue = RawUInt32(bytes, start + 52),
            sizeOfImage = UInt32(header.SizeOfImage),
            sizeOfHeaders = UInt32(header.SizeOfHeaders),
            checksum = header.CheckSum,
            subsystem = (ushort)header.Subsystem,
            dllCharacteristics = (ushort)header.DllCharacteristics,
            sizeOfStackReserve = Hex(header.SizeOfStackReserve),
            sizeOfStackCommit = Hex(header.SizeOfStackCommit),
            sizeOfHeapReserve = Hex(header.SizeOfHeapReserve),
            sizeOfHeapCommit = Hex(header.SizeOfHeapCommit),
            loaderFlags = RawUInt32(bytes, start + (wide ? 104 : 88)),
            directoryCount = header.NumberOfRvaAndSizes
        };
    }

    private static object[] ObserveSections(PEHeaders headers)
    {
        return headers.SectionHeaders.Select(section => (object)new
        {
            name = section.Name,
            rva = UInt32(section.VirtualAddress),
            virtualSize = UInt32(section.VirtualSize),
            size = UInt32(section.SizeOfRawData),
            offset = UInt32(section.PointerToRawData),
            characteristics = (uint)section.SectionCharacteristics,
            pointerToRelocations = UInt32(section.PointerToRelocations),
            pointerToLineNumbers = UInt32(section.PointerToLineNumbers),
            numberOfRelocations = unchecked((ushort)section.NumberOfRelocations),
            numberOfLineNumbers = unchecked((ushort)section.NumberOfLineNumbers)
        }).ToArray();
    }

    private static List<object> ObserveDirectories(PEHeaders headers, byte[] bytes)
    {
        PEHeader header = headers.PEHeader!;
        var standard = new (string Name, DirectoryEntry Entry)[]
        {
            ("export", header.ExportTableDirectory),
            ("import", header.ImportTableDirectory),
            ("resource", header.ResourceTableDirectory),
            ("exception", header.ExceptionTableDirectory),
            ("certificate", header.CertificateTableDirectory),
            ("baseRelocation", header.BaseRelocationTableDirectory),
            ("debug", header.DebugTableDirectory),
            ("architecture", header.CopyrightTableDirectory),
            ("globalPointer", header.GlobalPointerTableDirectory),
            ("threadLocalStorage", header.ThreadLocalStorageTableDirectory),
            ("loadConfiguration", header.LoadConfigTableDirectory),
            ("boundImport", header.BoundImportTableDirectory),
            ("importAddressTable", header.ImportAddressTableDirectory),
            ("delayImport", header.DelayImportTableDirectory),
            ("cliHeader", header.CorHeaderTableDirectory)
        };
        int count = header.NumberOfRvaAndSizes;
        int prefix = header.Magic == PEMagic.PE32Plus ? 112 : 96;
        int optionalSize = unchecked((ushort)headers.CoffHeader.SizeOfOptionalHeader);
        if (count < 0 || count > 64 || count * 8 > optionalSize - prefix)
            throw new BadImageFormatException("Observer optional-header directory extent is invalid.");
        var result = new List<object>(count);
        for (int index = 0; index < count; index++)
        {
            string name = index < standard.Length ? standard[index].Name
                : index == 15 ? "reserved" : "directory" + index.ToString(CultureInfo.InvariantCulture);
            int at = headers.PEHeaderStartOffset + prefix + index * 8;
            // SRM exposes the first 15 entries. Retain the remaining declared raw entries independently.
            uint address = index < standard.Length
                ? UInt32(standard[index].Entry.RelativeVirtualAddress) : RawUInt32(bytes, at);
            uint size = index < standard.Length
                ? UInt32(standard[index].Entry.Size) : RawUInt32(bytes, at + 4);
            result.Add(new { name, address, addressKind = index == 4 ? "file-offset" : "rva", size });
        }
        return result;
    }

    private static object ObserveCli(PEHeaders headers, byte[] bytes)
    {
        CorHeader cli = headers.CorHeader!;
        return new
        {
            headerSize = RawUInt32(bytes, headers.CorHeaderStartOffset),
            version = new[] { cli.MajorRuntimeVersion, cli.MinorRuntimeVersion },
            flags = (uint)cli.Flags,
            entryPoint = new
            {
                kind = (cli.Flags & CorFlags.NativeEntryPoint) != 0 ? "native-rva" : "managed-token",
                value = UInt32(cli.EntryPointTokenOrRelativeVirtualAddress)
            },
            metadataDirectory = DirectoryFacts(cli.MetadataDirectory),
            resources = DirectoryFacts(cli.ResourcesDirectory),
            strongNameSignature = DirectoryFacts(cli.StrongNameSignatureDirectory),
            codeManagerTable = DirectoryFacts(cli.CodeManagerTableDirectory),
            vtableFixups = DirectoryFacts(cli.VtableFixupsDirectory),
            exportAddressTableJumps = DirectoryFacts(cli.ExportAddressTableJumpsDirectory),
            managedNativeHeader = DirectoryFacts(cli.ManagedNativeHeaderDirectory)
        };
    }

    private static object DirectoryFacts(DirectoryEntry entry)
    {
        return new { rva = UInt32(entry.RelativeVirtualAddress), size = UInt32(entry.Size) };
    }

    private static uint? ReadManagedNativeSignature(PEReader pe, byte[] bytes, DirectoryEntry entry)
    {
        if (entry.Size == 0)
            return null;
        ReadOnlySpan<byte> data = DirectoryBytes(pe, bytes, entry);
        if (data.Length < 4)
            throw new BadImageFormatException("Managed native header has no complete signature.");
        return BinaryPrimitives.ReadUInt32LittleEndian(data);
    }

    private static string ClassifyImage(CorHeader cli, uint? signature)
    {
        if (signature.HasValue)
            return signature.Value == 0x00525452 ? "ReadyToRun" : "ManagedNative";
        return (cli.Flags & CorFlags.ILOnly) != 0 ? "ILOnly" : "MixedMode";
    }

    private static List<object> ObserveDebug(PEReader pe, byte[] bytes)
    {
        DirectoryEntry location = pe.PEHeaders.PEHeader!.DebugTableDirectory;
        if (location.Size < 0 || location.Size / 28 > MaxDebugEntries)
            throw new BadImageFormatException("Observer debug entry limit exceeded.");
        // Keep native validation, including its rejection of nonzero reserved Characteristics.
        var entries = pe.ReadDebugDirectory();
        var result = new List<object>(entries.Length);
        if (entries.Length == 0)
            return result;
        if (!pe.PEHeaders.TryGetDirectoryOffset(location, out int directoryOffset))
            throw new BadImageFormatException("Debug directory cannot be mapped.");
        long totalBytes = 0;
        for (int index = 0; index < entries.Length; index++)
        {
            DebugDirectoryEntry entry = entries[index];
            totalBytes += entry.DataSize;
            if (totalBytes > MaxImageBytes)
                throw new BadImageFormatException("Observer aggregate debug byte limit exceeded.");
            ReadOnlySpan<byte> payload = Range(bytes, entry.DataPointer, entry.DataSize);
            result.Add(new
            {
                characteristics = RawUInt32(bytes, directoryOffset + index * 28),
                stamp = entry.Stamp,
                major = entry.MajorVersion,
                minor = entry.MinorVersion,
                kind = (uint)entry.Type,
                dataRva = UInt32(entry.DataRelativeVirtualAddress),
                offset = UInt32(entry.DataPointer),
                size = UInt32(entry.DataSize),
                payloadSha256 = Hash(payload)
            });
        }
        return result;
    }

    private static object ObserveStrongName(PEReader pe, byte[] bytes, MetadataReader metadata)
    {
        CorHeader cli = pe.PEHeaders.CorHeader!;
        byte[] publicKey = Array.Empty<byte>();
        bool publicKeyFlag = false;
        if (metadata.IsAssembly)
        {
            AssemblyDefinition assembly = metadata.GetAssemblyDefinition();
            publicKey = metadata.GetBlobBytes(assembly.PublicKey);
            publicKeyFlag = (assembly.Flags & AssemblyFlags.PublicKey) != 0;
        }
        ReadOnlySpan<byte> signature = DirectoryBytes(pe, bytes, cli.StrongNameSignatureDirectory);
        bool zeroFilled = true;
        foreach (byte value in signature)
        {
            if (value != 0)
            {
                zeroFilled = false;
                break;
            }
        }
        return new
        {
            publicKeyFlag,
            signedFlag = (cli.Flags & CorFlags.StrongNameSigned) != 0,
            publicKeySize = publicKey.Length,
            publicKeySha256 = Hash(publicKey),
            signatureSize = signature.Length,
            signatureState = signature.Length == 0 ? "absent" : zeroFilled ? "zero-filled" : "nonzero",
            signatureSha256 = signature.Length == 0 ? null : Hash(signature),
            verification = "not-performed"
        };
    }

    private static List<object> ObserveMethods(PEReader pe, MetadataReader metadata)
    {
        if (metadata.MethodDefinitions.Count > MaxMethods)
            throw new BadImageFormatException("Observer method count limit exceeded.");
        var result = new List<object>(metadata.MethodDefinitions.Count);
        foreach (MethodDefinitionHandle handle in metadata.MethodDefinitions)
        {
            MethodDefinition method = metadata.GetMethodDefinition(handle);
            MethodImplAttributes implementation = method.ImplAttributes;
            int rva = method.RelativeVirtualAddress;
            MethodImplAttributes bodyKind = implementation
                & (MethodImplAttributes.CodeTypeMask | MethodImplAttributes.ManagedMask);
            bool hasCilBody = rva != 0 && bodyKind == MethodImplAttributes.IL;
            object? body = null;
            object? bodyError = null;
            if (hasCilBody)
            {
                try
                {
                    body = ObserveBody(pe, rva);
                }
                catch (Exception error) when (error is BadImageFormatException or ArgumentException or OverflowException)
                {
                    bodyError = new { type = error.GetType().FullName, message = error.Message };
                }
            }
            result.Add(new
            {
                token = MetadataTokens.GetToken(handle),
                name = metadata.GetString(method.Name),
                implFlags = (ushort)implementation,
                rva = UInt32(rva),
                codeKind = CodeKind(implementation),
                hasCilBody,
                body,
                bodyError
            });
        }
        return result;
    }

    private static string CodeKind(MethodImplAttributes implementation)
    {
        MethodImplAttributes codeType = implementation & MethodImplAttributes.CodeTypeMask;
        if (codeType == MethodImplAttributes.IL)
            return (implementation & MethodImplAttributes.ManagedMask) == MethodImplAttributes.Unmanaged ? "UnmanagedIL" : "CIL";
        return codeType switch
        {
            MethodImplAttributes.Native => "Native",
            MethodImplAttributes.OPTIL => "OPTIL",
            MethodImplAttributes.Runtime => "Runtime",
            _ => throw new BadImageFormatException("Unknown method code type.")
        };
    }

    private static object ObserveBody(PEReader pe, int rva)
    {
        // CodeTypeMask and ManagedMask are checked by the only caller, independently of image-level ILOnly.
        MethodBodyBlock body = pe.GetMethodBody(rva);
        byte[] code = body.GetILBytes() ?? Array.Empty<byte>();
        BlobReader reader = pe.GetSectionData(rva).GetReader();
        byte first = reader.ReadByte();
        int headerSize = (first & 3) switch
        {
            2 => 1,
            3 => ((first | (reader.ReadByte() << 8)) >> 12) * 4,
            _ => throw new BadImageFormatException("Unexpected managed method header format.")
        };
        return new
        {
            headerSize,
            totalSize = body.Size,
            codeSize = code.Length,
            maxStack = body.MaxStack,
            localSignature = body.LocalSignature.IsNil ? 0 : MetadataTokens.GetToken(body.LocalSignature),
            initLocals = body.LocalVariablesInitialized,
            exceptionRegionCount = body.ExceptionRegions.Length,
            codeSha256 = Hash(code)
        };
    }

    private static ReadOnlySpan<byte> DirectoryBytes(PEReader pe, byte[] bytes, DirectoryEntry entry)
    {
        if (entry.Size == 0)
            return ReadOnlySpan<byte>.Empty;
        if (!pe.PEHeaders.TryGetDirectoryOffset(entry, out int offset))
            throw new BadImageFormatException("CLI directory cannot be mapped.");
        return Range(bytes, offset, entry.Size);
    }

    private static ReadOnlySpan<byte> Range(byte[] bytes, int offset, int size)
    {
        if (offset < 0 || size < 0 || offset > bytes.Length || size > bytes.Length - offset)
            throw new BadImageFormatException("Observer file range is invalid.");
        return bytes.AsSpan(offset, size);
    }

    private static uint RawUInt32(byte[] bytes, int offset)
    {
        return BinaryPrimitives.ReadUInt32LittleEndian(Range(bytes, offset, 4));
    }

    private static uint UInt32(int value) => unchecked((uint)value);
    private static string Hex(ulong value) => "0x" + value.ToString("x", CultureInfo.InvariantCulture);
    private static string Hash(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
