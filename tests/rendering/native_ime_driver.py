"""Use the browser's composition protocol instead of dispatchEvent to qualify IME integration."""


def run_native_ime(page, browser):
    if browser.browser_type.name != 'chromium':
        return {'passed': False, 'status': 'incomplete-native-ime',
                'reason': 'This driver has no native composition protocol for the selected browser'}
    focused = page.evaluate("() => globalThis.renderingConformance.interaction('focus')")
    if not focused.get('focused') or focused.get('inputTag') != 'INPUT':
        raise ValueError('Native IME target did not obtain actual browser focus')
    protocol = page.context.new_cdp_session(page)
    try:
        protocol.send('Input.imeSetComposition', {'text': '漢', 'selectionStart': 0, 'selectionEnd': 1})
        protocol.send('Input.imeSetComposition', {'text': '漢字', 'selectionStart': 0, 'selectionEnd': 2})
        protocol.send('Input.insertText', {'text': '漢字'})
        return page.evaluate("() => globalThis.renderingConformance.interaction('finish')")
    finally:
        protocol.detach()
