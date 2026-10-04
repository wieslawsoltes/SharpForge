"""Whole-source editing through the real Studio editor and trusted browser input."""

import json

from playwright.sync_api import Page


def reveal_source(page: Page, uri: str) -> None:
    """Expose a hidden source pane through its document's real Split control."""
    quoted_uri = json.dumps(uri)
    source = page.locator(f'[data-source-uri={quoted_uri}] textarea.sf-input')
    if source.count() != 1:
        raise AssertionError(f'Expected one source editor for {uri}.')
    if source.is_visible():
        return
    document = page.locator(f'[data-designer-document={quoted_uri}]')
    document.locator('[data-document-view="split"]').click()
    source.wait_for(state='visible')


def replace_source(page: Page, uri: str, text: str) -> None:
    """Select the complete model, insert trusted input, and require exact source equality."""
    page.evaluate("uri => sharpforge.openFile(uri)", uri)
    reveal_source(page, uri)
    # Playwright fill selects in its utility world, which sees only the hidden
    # textarea's bounded native context. The main-world adapter selects the model.
    observation = page.evaluate_handle("""uri => {
        const inputs = [...document.querySelectorAll('[data-source-uri] textarea.sf-input')]
            .filter(input => input.closest('[data-source-uri]').dataset.sourceUri === uri);
        if (inputs.length !== 1) throw new Error('Expected one source editor for ' + uri);
        const input = inputs[0];
        input.focus({preventScroll: true});
        input.setSelectionRange(0, input.value.length);
        if (document.activeElement !== input || input.readOnly || input.disabled || !input.getClientRects().length) {
            throw new Error('Whole-source input must target the focused, visible, editable source pane.');
        }
        const state = sharpforge.getEditorState(uri);
        if (!state || state.start !== 0 || state.end !== state.value.length || input.value !== state.value) {
            throw new Error('Whole-source selection did not cover the complete editor model.');
        }
        const events = [];
        let dropped = 0;
        const capture = event => {
            if (events.length === 64) {
                dropped++;
                return;
            }
            events.push({type: event.type, key: event.key ?? null,
                inputType: event.inputType ?? null, trusted: event.isTrusted});
        };
        const types = ['keydown', 'beforeinput', 'input'];
        for (const type of types) input.addEventListener(type, capture, true);
        return {
            stop() {
                for (const type of types) input.removeEventListener(type, capture, true);
                return {events, dropped};
            }
        };
    }""", uri)
    try:
        if text:
            page.keyboard.insert_text(text)
        else:
            page.keyboard.press("Delete")
        page.wait_for_function("""({uri, text}) => {
            const editor = sharpforge.getEditorState(uri);
            const source = sharpforge.getState().files.find(file => file.uri === uri);
            return editor?.value === text && source?.text === text;
        }""", arg={"uri": uri, "text": text}, timeout=30000)
    finally:
        evidence = observation.evaluate("observation => observation.stop()")
        observation.dispose()
    if evidence["dropped"]:
        raise AssertionError("Source replacement exceeded the bounded input observation.")
    trusted = [event for event in evidence["events"] if event["trusted"]]
    if text:
        accepted = any(event["type"] in ("beforeinput", "input")
                       and event["inputType"] in ("insertText", "insertReplacementText") for event in trusted)
    else:
        accepted = any(event["type"] == "keydown" and event["key"] == "Delete" for event in trusted)
    if not accepted:
        raise AssertionError("Whole-source replacement did not produce the expected trusted browser input.")
