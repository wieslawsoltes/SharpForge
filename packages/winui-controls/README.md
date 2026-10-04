# @sharpforge/winui-controls

Layout, input and WinUI control models with pluggable host renderers.

This package contains framework-independent services. Hosts supply their type registry,
managed values, scheduling, rendering and permission services explicitly. Import public
APIs from `@sharpforge/winui-controls`; implementation paths are not public contracts.

Instances belong to an application or rendering session and must be disposed with it.
Control model, renderer, managed adapter and platform service APIs are described
in [FAMILIES.md](FAMILIES.md).
Focused contracts and scope are documented in [LAYOUT-INPUT.md](LAYOUT-INPUT.md),
[SCROLLING.md](SCROLLING.md), [AUTOMATION.md](AUTOMATION.md),
[ENVIRONMENT.md](ENVIRONMENT.md), and [DRAG_DROP.md](DRAG_DROP.md).
[ACCEPTANCE.md](ACCEPTANCE.md) records authored coverage and the pending
integrated qualification gate.

Project 14 additions are allocated from the existing area contract reservations. Released
framework contract identifiers and signatures retain their original meanings.
