/**
 * The namespaces of the .NET base class library (SF-A02-T24): every namespace that declares a public type in the
 * Microsoft.NETCore.App 10.0 reference pack, with its parent namespaces.
 *
 * The framework registry models only part of the BCL. A using directive or qualified name that mentions one of
 * these namespaces is therefore valid even when the registry has no type in it; any other `System.*` or
 * `Microsoft.*` name is unknown and reported like in Roslyn (CS0234, CS0246).
 * The list is data extracted from the reference assemblies, not a pattern: update it when the reference pack changes.
 */
const names = `
  Microsoft Microsoft.CSharp Microsoft.CSharp.RuntimeBinder Microsoft.VisualBasic
  Microsoft.VisualBasic.CompilerServices Microsoft.VisualBasic.FileIO Microsoft.Win32 Microsoft.Win32.SafeHandles
  System System.Buffers System.Buffers.Binary System.Buffers.Text System.CodeDom System.CodeDom.Compiler
  System.Collections System.Collections.Concurrent System.Collections.Frozen System.Collections.Generic
  System.Collections.Immutable System.Collections.ObjectModel System.Collections.Specialized System.ComponentModel
  System.ComponentModel.DataAnnotations System.ComponentModel.DataAnnotations.Schema System.ComponentModel.Design
  System.ComponentModel.Design.Serialization System.Configuration System.Configuration.Assemblies System.Data
  System.Data.Common System.Data.SqlTypes System.Diagnostics System.Diagnostics.CodeAnalysis
  System.Diagnostics.Contracts System.Diagnostics.Metrics System.Diagnostics.SymbolStore System.Diagnostics.Tracing
  System.Drawing System.Dynamic System.Formats System.Formats.Asn1 System.Formats.Tar System.Globalization System.IO
  System.IO.Compression System.IO.Enumeration System.IO.IsolatedStorage System.IO.MemoryMappedFiles
  System.IO.Pipelines System.IO.Pipes System.Linq System.Linq.Expressions System.Net System.Net.Cache System.Net.Http
  System.Net.Http.Headers System.Net.Http.Json System.Net.Http.Metrics System.Net.Mail System.Net.Mime
  System.Net.NetworkInformation System.Net.Quic System.Net.Security System.Net.ServerSentEvents System.Net.Sockets
  System.Net.WebSockets System.Numerics System.Reflection System.Reflection.Emit System.Reflection.Metadata
  System.Reflection.Metadata.Ecma335 System.Reflection.PortableExecutable System.Resources System.Runtime
  System.Runtime.CompilerServices System.Runtime.ConstrainedExecution System.Runtime.ExceptionServices
  System.Runtime.InteropServices System.Runtime.InteropServices.ComTypes System.Runtime.InteropServices.Java
  System.Runtime.InteropServices.JavaScript System.Runtime.InteropServices.Marshalling
  System.Runtime.InteropServices.ObjectiveC System.Runtime.InteropServices.Swift System.Runtime.Intrinsics
  System.Runtime.Intrinsics.Arm System.Runtime.Intrinsics.Wasm System.Runtime.Intrinsics.X86 System.Runtime.Loader
  System.Runtime.Remoting System.Runtime.Serialization System.Runtime.Serialization.DataContracts
  System.Runtime.Serialization.Formatters System.Runtime.Serialization.Formatters.Binary
  System.Runtime.Serialization.Json System.Runtime.Versioning System.Security System.Security.AccessControl
  System.Security.Authentication System.Security.Authentication.ExtendedProtection System.Security.Claims
  System.Security.Cryptography System.Security.Cryptography.X509Certificates System.Security.Permissions
  System.Security.Policy System.Security.Principal System.Text System.Text.Encodings System.Text.Encodings.Web
  System.Text.Json System.Text.Json.Nodes System.Text.Json.Schema System.Text.Json.Serialization
  System.Text.Json.Serialization.Metadata System.Text.RegularExpressions System.Text.Unicode System.Threading
  System.Threading.Channels System.Threading.Tasks System.Threading.Tasks.Dataflow System.Threading.Tasks.Sources
  System.Timers System.Transactions System.Web System.Windows System.Windows.Input System.Windows.Markup System.Xml
  System.Xml.Linq System.Xml.Resolvers System.Xml.Schema System.Xml.Serialization System.Xml.XPath System.Xml.Xsl`;

const bclNamespaces = new Set(names.split(/\s+/).filter(Boolean));

/** True when `name` (dotted, no whitespace) is a namespace of the base class library. */
export function isBclNamespace(name) {
  return bclNamespaces.has(name);
}

/** Every BCL namespace name, sorted. */
export function bclNamespaceNames() {
  return [...bclNamespaces].sort();
}
