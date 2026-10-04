#nullable enable
using NullableMetadata;

public class ConstraintConsumer
{
    public Surface<string, object, object?, string?, int, IContract<string?>>? Good;
    public Surface<string?, object?, object?, string?, int, IContract<string?>?>? Bad;
}
