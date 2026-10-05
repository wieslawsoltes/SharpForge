# Native tool renderer host contract

`renderNativeTool(panel, element, {nativeBuild, state})` is the small composition
seam used by Studio's tool renderer. It returns true when it handles a panel and
false when the caller should continue its existing rendering path.

MSBuild, inspector, project-source and tests panels delegate to the supplied
`nativeBuild.render(panel, element)` method with its original receiver. Native
project properties render an escaped workspace summary and existing data-command
hooks. Other panels and portable project properties remain caller-owned.

The helper imports only the existing editor escape function. It does not create a
controller, connect a host, execute a target, install event handlers or register a
panel. Those are explicit dependent application/controller responsibilities.
