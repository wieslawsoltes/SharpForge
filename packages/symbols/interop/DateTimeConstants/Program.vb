Imports System
Imports System.Globalization
Imports System.IO
Imports System.Linq
Imports System.Reflection.Metadata
Imports System.Reflection.Metadata.Ecma335
Imports System.Reflection.PortableExecutable
Imports System.Text.Json

Public Module Fixture
    Public Function Constants() As Date()
        Const Earliest As Date = #1/1/0001#
        Const LeapDay As Date = #2/29/2000 12:34:56 PM#
        Const Modern As Date = #10/4/2026 1:02:03 AM#
        Const LastSecond As Date = #12/31/9999 11:59:59 PM#
        Return {Earliest, LeapDay, Modern, LastSecond}
    End Function
End Module

Public Module Program
    Private Function ReadConstant(pdb As MetadataReader, metadata As MetadataReader, handle As LocalConstantHandle) As Object
        Dim constant = pdb.GetLocalConstant(handle)
        Dim reader = pdb.GetBlobReader(constant.Signature)
        Dim code = reader.ReadByte()
        If code <> 17 Then Throw New BadImageFormatException("Expected VALUETYPE")
        Dim encoded = reader.ReadCompressedInteger()
        If (encoded And 3) <> 1 Then Throw New BadImageFormatException("Expected TypeRef")
        Dim token = &H1000000 Or (encoded >> 2)
        Dim definition = metadata.GetTypeReference(CType(MetadataTokens.EntityHandle(token), TypeReferenceHandle))
        Dim value = reader.ReadDateTime()
        If reader.RemainingBytes <> 0 Then Throw New BadImageFormatException("Trailing DateTime bytes")
        Return New With {
            .name = pdb.GetString(constant.Name), .code = code, .typeToken = token,
            .typeName = metadata.GetString(definition.Namespace) & "." & metadata.GetString(definition.Name),
            .ticks = value.Ticks.ToString(CultureInfo.InvariantCulture), .kind = value.Kind.ToString(),
            .text = value.ToString("O", CultureInfo.InvariantCulture),
            .signature = Convert.ToHexString(pdb.GetBlobBytes(constant.Signature))
        }
    End Function

    Private Function RejectedTicks(ticks As Long) As Object
        Try
            Dim value As New DateTime(ticks)
            Return New With {.ticks = ticks.ToString(CultureInfo.InvariantCulture), .error = "accepted"}
        Catch exception As ArgumentOutOfRangeException
            Return New With {.ticks = ticks.ToString(CultureInfo.InvariantCulture), .error = exception.GetType().Name}
        End Try
    End Function

    Public Sub Main()
        Dim path = GetType(Fixture).Assembly.Location
        Dim singleTick As New DateTime(1)
        Dim minimum As New DateTime(0)
        Using pe As New PEReader(File.OpenRead(path))
            Using provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(IO.Path.ChangeExtension(path, ".pdb")))
                Dim pdb = provider.GetMetadataReader()
                Dim metadata = pe.GetMetadataReader()
                Console.WriteLine(JsonSerializer.Serialize(New With {
                    .runtime = Environment.Version.ToString(),
                    .constants = pdb.LocalConstants.Select(Function(handle) ReadConstant(pdb, metadata, handle)).ToArray(),
                    .limits = New With {
                        .minimum = DateTime.MinValue.Ticks.ToString(CultureInfo.InvariantCulture),
                        .maximum = DateTime.MaxValue.Ticks.ToString(CultureInfo.InvariantCulture),
                        .singleTick = singleTick.ToString("O", CultureInfo.InvariantCulture),
                        .kind = minimum.Kind.ToString()
                    },
                    .rejected = {RejectedTicks(-1), RejectedTicks(3155378976000000000L)}
                }))
            End Using
        End Using
    End Sub
End Module
