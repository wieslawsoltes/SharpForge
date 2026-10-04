"""One actual Studio 200 MiB File-input lifecycle; OS file permissions are not exercised.

The existing five-size editor benchmark owns latency budgets. This separate case
qualifies File/Blob decoding, workspace adoption and the mounted Studio editor.
Only bounded source ranges and scalar metadata cross the Playwright boundary.
"""
import json
import os
import platform
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir, selected_engine


SIZE_BYTES = 200 * 1024 * 1024
URI = "A20StudioLargeFile.cs"
MAX_VISIBLE_ROWS = 160


def require(value, message):
    if not value:
        raise AssertionError(message)


def begin_import(page):
    """Use the real input's registered change handler, without replacing its provider."""
    return page.evaluate("""({sizeBytes, uri}) => {
      const documents = sharpforge.documents;
      if (documents.models.has(uri)) throw new Error('Large-file fixture already exists');
      const prefix = '// A20_STUDIO_200_MIB_BEGIN\\n';
      const suffix = '\\n// A20_STUDIO_200_MIB_END\\n';
      const line = '// ' + 'x'.repeat(1020) + '\\n';
      const chunk = new Blob([line.repeat(256)], {type: 'text/plain'});
      const bodyBytes = sizeBytes - prefix.length - suffix.length;
      const fullChunks = Math.floor(bodyBytes / chunk.size);
      const remainderBytes = bodyBytes % chunk.size;
      const parts = [prefix];
      for (let index = 0; index < fullChunks; index++) parts.push(chunk);
      if (remainderBytes) parts.push(chunk.slice(0, remainderBytes));
      parts.push(suffix);
      const file = new File(parts, uri, {type: 'text/plain', lastModified: 0});
      if (file.size !== sizeBytes) throw new Error('Incorrect File fixture byte count');
      const originalModels = new Map(documents.models);
      const expectedLines = Math.floor(bodyBytes / line.length) + 4;
      window.a20LargeIngress = {
        documents, uri, sizeBytes, prefix, suffix, expectedLines, originalModels,
        markerOffset: sizeBytes - suffix.length + 1,
        started: performance.now()
      };
      const selection = new DataTransfer();
      selection.items.add(file);
      const input = document.getElementById('file-input');
      input.files = selection.files;
      input.dispatchEvent(new Event('change', {bubbles: true}));
      return {sizeBytes: file.size, originalSourceCount: originalModels.size,
        expectedSourceCount: originalModels.size + 1, expectedLines,
        reusedChunkBytes: chunk.size, blobPartCount: parts.length};
    }""", {"sizeBytes": SIZE_BYTES, "uri": URI})


def await_import(page):
    wait_condition(page, """() => {
      const state = window.a20LargeIngress;
      const error = document.querySelector('#toasts .toast.error');
      if (error) throw new Error('Studio import: ' + error.textContent.slice(0, 1000));
      const model = state.documents.models.get(state.uri);
      const editor = state.documents.editors.get(state.uri);
      return model && editor && editor.model === model && state.documents.active === state.uri
        && model.length === state.sizeBytes && !sharpforge.workbenchServices.builds.list().some(build => build.busy);
    }""", timeout=180000)
    return page.evaluate("""async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const state = a20LargeIngress;
      const record = state.documents.require(state.uri);
      const model = state.documents.models.get(state.uri);
      const editor = state.documents.editors.get(state.uri);
      const source = model.snapshot();
      state.model = model;
      state.editor = editor;
      state.record = record;
      state.version = model.version;
      return {
        elapsedMs: performance.now() - state.started,
        sourceCount: state.documents.list().length,
        byteLength: record.byteLength, sourceLength: source.length, lineCount: model.lineCount,
        uri: record.uri, active: state.documents.active, encoding: record.encoding, bom: record.bom,
        originalSource: record.originalSource === source, ownedSource: record.source === source,
        sharedModel: editor.model === model, versionMatches: record.version === model.version,
        retainedSiblings: [...state.originalModels].every(([uri, previous]) => state.documents.models.get(uri) === previous),
        prefixMatches: model.getText(0, state.prefix.length) === state.prefix,
        suffixMatches: model.getText(state.sizeBytes - state.suffix.length, state.sizeBytes) === state.suffix,
        textMaterialized: source.statistics.textMaterialized,
        largeFile: editor.largeFile.active, dirty: record.dirty,
        selectionConsumed: document.getElementById('file-input').files.length === 0
      };
    }""")


def inspect_viewport(page, end=False):
    """Inspect only rendered spans, with explicit bounds before reading source ranges."""
    return page.evaluate("""async ({end, maximumRows}) => {
      const state = a20LargeIngress;
      const {editor, model} = state;
      const offset = end ? state.markerOffset : 0;
      editor.goto(offset);
      editor.focus();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const rows = [...editor.view.lines.visible.values()];
      if (!rows.length || rows.length > maximumRows) throw new Error('Viewport row budget exceeded');
      let characters = 0;
      const lines = [];
      for (const row of rows) {
        const text = [...row.querySelectorAll('[data-offset]')].map(span => span.textContent).join('');
        characters += text.length;
        if (text.length > 4096 || characters > maximumRows * 4096) throw new Error('Rendered source range budget exceeded');
        const start = Number(row.dataset.start);
        if (text !== model.getText(start, start + text.length)) throw new Error('Rendered row differs from the source model');
        lines.push(Number(row.dataset.line));
      }
      const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').get.call(editor.input);
      const targetLine = model.positionAt(offset).line;
      const viewport = editor.view.viewport.getBoundingClientRect();
      return {
        end, offset, caret: editor.offset, targetLine, firstLine: Math.min(...lines), lastLine: Math.max(...lines),
        targetVisible: lines.includes(targetLine), rows: rows.length, renderedCharacters: characters,
        scrollTop: editor.view.scrollTop, nativeContextLength: nativeValue.length,
        viewportVisible: viewport.width > 0 && viewport.height > 0,
        textMaterialized: model.snapshot().statistics.textMaterialized
      };
    }""", {"end": end, "maximumRows": MAX_VISIBLE_ROWS})


def edit_and_undo(page):
    page.keyboard.type("X")
    edited = page.evaluate("""async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const state = a20LargeIngress;
      return {
        length: state.model.length, version: state.model.version, dirty: state.record.dirty,
        insertion: state.model.getText(state.markerOffset, state.markerOffset + 2),
        sameModel: state.documents.models.get(state.uri) === state.model && state.editor.model === state.model,
        sameRecord: state.documents.get(state.uri) === state.record,
        textMaterialized: state.model.snapshot().statistics.textMaterialized
      };
    }""")
    require(edited["length"] == SIZE_BYTES + 1 and edited["insertion"] == "X/", "Keyboard input did not edit the end marker")
    require(edited["dirty"] and edited["sameModel"] and edited["sameRecord"], "Keyboard edit lost document ownership or dirty state")
    require(not edited["textMaterialized"], "Keyboard edit materialized the whole source")
    undo_key = page.evaluate("/Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+z' : 'Control+z'")
    page.keyboard.press(undo_key)
    restored = page.evaluate("""async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const state = a20LargeIngress;
      return {
        length: state.model.length, version: state.model.version, dirty: state.record.dirty,
        suffixMatches: state.model.getText(state.sizeBytes - state.suffix.length, state.sizeBytes) === state.suffix,
        prefixMatches: state.model.getText(0, state.prefix.length) === state.prefix,
        sourceCount: state.documents.list().length,
        sameModel: state.documents.models.get(state.uri) === state.model && state.editor.model === state.model,
        textMaterialized: state.model.snapshot().statistics.textMaterialized
      };
    }""")
    require(restored["length"] == SIZE_BYTES and restored["suffixMatches"] and restored["prefixMatches"], "Undo did not restore source boundaries")
    require(restored["version"] > edited["version"] and not restored["dirty"], "Undo did not restore the clean saved state")
    require(restored["sameModel"] and not restored["textMaterialized"], "Undo replaced or flattened the shared model")
    return {"edited": edited, "restored": restored, "undoKey": undo_key}


def dispose_studio(page):
    return page.evaluate("""() => {
      const state = a20LargeIngress;
      window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: false}));
      let rejected = false;
      try { state.model.setReadOnly(true); }
      catch (error) { rejected = error.message === 'EditorModel is disposed'; }
      const result = {
        documentsDisposed: state.documents.disposed, editorDisposed: state.editor.disposed,
        records: state.documents.records.size, models: state.documents.models.size, views: state.documents.views.size,
        renderedRows: state.editor.element.querySelectorAll('.sf-view-line').length,
        disposedModelRejectsMutation: rejected
      };
      window.a20LargeIngress = null;
      return result;
    }""")


def qualify(page, report):
    load_application(page)
    wait_condition(page, "!!window.sharpforge?.documents && !sharpforge.workbenchServices.builds.list().some(build => build.busy)")
    report["fixture"] = begin_import(page)
    opened = report["opened"] = await_import(page)
    require(opened["sourceCount"] == report["fixture"]["expectedSourceCount"], "Import changed the expected source count")
    require(opened["byteLength"] == SIZE_BYTES and opened["sourceLength"] == SIZE_BYTES, "Accepted byte/source length is incorrect")
    require(opened["lineCount"] == report["fixture"]["expectedLines"], "Chunk decoding lost source line boundaries")
    require(opened["uri"] == URI and opened["active"] == URI and opened["selectionConsumed"], "File input did not select the imported source")
    require(opened["encoding"] == "utf-8" and not opened["bom"], "File input decoding metadata is incorrect")
    for name in ["originalSource", "ownedSource", "sharedModel", "versionMatches", "retainedSiblings", "prefixMatches", "suffixMatches", "largeFile"]:
        require(opened[name], "Invalid imported document: " + name)
    require(not opened["dirty"] and not opened["textMaterialized"], "Import must adopt a clean, unmaterialized source")
    report["viewports"] = []
    for end in [False, True]:
        viewport = inspect_viewport(page, end)
        report["viewports"].append(viewport)
        require(viewport["targetVisible"] and viewport["viewportVisible"], "Target source is not visible in the real viewport")
        require(viewport["nativeContextLength"] <= 2048, "Native input mirrored the large source")
        require(viewport["caret"] == viewport["offset"] and not viewport["textMaterialized"], "Navigation changed or flattened the source")
        if end:
            require(viewport["scrollTop"] > 0 and viewport["firstLine"] > opened["lineCount"] - MAX_VISIBLE_ROWS,
                    "End navigation did not scroll to the last source lines")
    report["editing"] = edit_and_undo(page)
    require(report["editing"]["restored"]["sourceCount"] == opened["sourceCount"], "Editing changed the document inventory")
    disposed = report["disposal"] = dispose_studio(page)
    require(disposed["documentsDisposed"] and disposed["editorDisposed"] and disposed["disposedModelRejectsMutation"],
            "Studio pagehide did not dispose the document, editor and model")
    require(all(disposed[key] == 0 for key in ["records", "models", "views", "renderedRows"]), "Disposed Studio retained live document views")


def run():
    report = {
        "status": "incomplete", "issue": 1513, "engine": selected_engine(), "host": platform.platform(),
        "sourceSha": os.getenv("QUALIFICATION_SOURCE_SHA"), "sourceTree": os.getenv("QUALIFICATION_SOURCE_TREE"),
        "input": "synthetic File/Blob assigned through DataTransfer to the real Studio file-input change handler",
        "limits": ["No OS file chooser or native file permission claim", "No physical disk throughput claim",
                   "No cross-application clipboard claim", "Functional case; latency budgets belong to the existing editor benchmark"],
        "pageErrors": [], "consoleErrors": []
    }
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            report["browserVersion"] = browser.version
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page.set_default_timeout(30000)
            page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
            page.on("console", lambda message: report["consoleErrors"].append(message.text) if message.type == "error" else None)
            qualify(page, report)
            require(not report["pageErrors"], "Uncaught browser errors: " + repr(report["pageErrors"]))
            require(not report["consoleErrors"], "Browser console errors: " + repr(report["consoleErrors"]))
        report["status"] = "passed"
    except BaseException as error:
        report["status"] = "failed"
        report["failure"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        destination = results_dir() / "a20-studio-large-file-results.json"
        destination.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf8")
        print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    run()
