/** Register semantic previews separately from mutation; the host owns the complete file/project journal transaction. */
export function registerTypeRenameHandlers(handlers, {language, refactoring}) {
  handlers.registerHandler('prepareTypeRename', params =>
    language.prepareTypeRename(params.uri, params.offset ?? null, params.newName, {name: params.name}));
  handlers.registerHandler('rename', params => refactoring.rename(params.uri, params.offset, params.newName).edits);
}
