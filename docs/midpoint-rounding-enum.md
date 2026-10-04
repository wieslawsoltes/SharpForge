# MidpointRounding enum prerequisite

The framework registry exposes `System.MidpointRounding` with the exact
[.NET 10.0.5 names and values](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/MidpointRounding.cs):
`ToEven = 0`, `AwayFromZero = 1`, `ToZero = 2`, `ToNegativeInfinity = 3`, and
`ToPositiveInfinity = 4`. Its underlying type remains the existing Int32 enum
storage category.

An enum-only contribution uses the reserved A05 area and runs after every
existing framework contribution. It appends the enum identity without adding
member contracts, shifting prior enum indices, changing builtin IDs, or adding
a new value carrier. Existing compiler enum symbols, source `ENUM`/conversion
operations, CIL enum signatures, arrays and names handle the new type.
As with ordinary .NET enums, an explicit cast can represent unnamed Int32
values; a consuming API decides whether such a value is valid for its operation.

`tests/a05-midpoint-rounding-enum.test.js` authors source, emitted direct-CIL and
reloaded-source coverage for all names/values, qualified aliases, arrays,
defaults, unnamed boundary values, rejected implicit
conversions, and preservation of the existing registry identities.

The already-supported CIL Decimal rounding descriptors refer to this exact enum.
Source Round overload registrations are a separate follow-up, including a
distinct wire identity for `Round(decimal, MidpointRounding)` alongside the
released `Round(decimal, int)` call. This prerequisite does not add those rows.

Static inspection of `scripts/planning/inventory-values.js` confirms that it
hashes an explicit source-file list and returns fixed carrier descriptions; it
does not enumerate framework types. Neither this contribution nor its manifest
is in that list, so this addition does not change the value ABI inventory.
Validation and native/platform qualification remain staged; no execution or
performance results are claimed.

Integration validation found existing source compiler limits: enum boxing is
rejected by semantic lowering; enum-to-integer casts and named values assigned
through integer casts do not consistently retain the intended representation.
This registration increment does not extend those compiler paths.
