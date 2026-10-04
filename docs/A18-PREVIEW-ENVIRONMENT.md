# Designer preview environment

`DesignPreviewEnvironment` keeps device size, scale, theme, contrast, direction and
adaptive state in the view session. Preview changes do not create document
transactions or change serialized resources and bindings.

The projection has two separate phases:

1. `environment.document(design)` returns a detached document with the selected
   viewport dimensions and adaptive overrides. Resource references and bindings
   remain intact. The result is still a valid authoring document.
2. `environment.applyToScene(scene)` applies RequestedTheme and high-contrast
   appearance to a resolved render scene owned by the caller and returns that
   same scene. Call it after resource, sample, template and component projection.
   It changes only schema-supported appearance properties and never evaluates
   binding expressions or modifies the source document.

The distinction matters when a property has a binding or resource reference:
adding a local preview value to the authoring document would create two competing
value sources and fail validation. Render-scene properties have already resolved
those sources and can safely receive temporary appearance overrides.

Studio's `buildDesignerPreviewScene` composes these phases in that order.
`DesignerLayoutPreview.scene()` also applies appearance for a standalone surface;
its `{appearance: false}` option lets the composing Studio host defer that final
phase until its richer value and component projections are complete. Returning
to normal contrast rebuilds from the unchanged authored values.

The high-contrast palette remains black Background, white Foreground,
BorderBrush and Fill, and yellow Stroke. The browser qualification checks the
real Canvas background and Button foreground; it does not substitute metadata
checks for rendered color assertions.
