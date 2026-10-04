// Local contracts are required by the pinned proposal. No runtime/library contract is synthesized by the compiler.
export const unionContracts = `
#nullable enable
namespace System.Runtime.CompilerServices
{
    public sealed class UnionAttribute : System.Attribute { }
    public interface IUnion { object? Value { get; } }
}
#nullable disable
`;

export const unionPreviewOptions = Object.freeze({ langVersion: 'preview', includeDebug: false, name: 'UnionProposal' });

export const unionInputs = source => [
  { text: source, uri: 'Program.cs' },
  { text: unionContracts, uri: 'UnionContracts.cs' },
];
