"""Operate the production attachment pickers without blocking Playwright on their pending promise."""
import time


ATTACH_TITLE = 'Attach running application'
STANDALONE = 'Open separate live design (no C# writeback)'
KEEP_SOURCE = 'Keep linked source only'


def _begin_attachment(page):
    page.evaluate("""() => {
        if (window.__releaseDesignerAttachment?.state === 'pending') {
            throw new Error('A previous release attachment is still pending');
        }
        const receipt = {state:'pending'};
        window.__releaseDesignerAttachment = receipt;
        Promise.resolve().then(() => sharpforge.designer.attach()).then(value => {
            receipt.state = value === null ? 'cancelled' : 'fulfilled';
            receipt.value = value;
        }, error => {
            receipt.state = 'rejected';
            receipt.error = {name:error.name,code:error.code,message:error.message};
        });
    }""")


def _picker_state(page):
    return page.evaluate("""() => {
        const backdrop = document.getElementById('modal-backdrop');
        const visible = !!backdrop && !backdrop.classList.contains('hidden');
        return {visible, title:visible ? document.getElementById('modal-title')?.textContent : null,
            choices:visible ? [...document.querySelectorAll('#explorer-choice option')].map(option => option.value) : []};
    }""")


def _wait_for_picker_or_result(page, timeout):
    page.wait_for_function("""() => {
        if (window.__releaseDesignerAttachment?.state !== 'pending') return true;
        const backdrop = document.getElementById('modal-backdrop');
        return !!backdrop && !backdrop.classList.contains('hidden') && !!document.getElementById('explorer-choice');
    }""", timeout=timeout)
    return page.evaluate('window.__releaseDesignerAttachment'), _picker_state(page)


def _assert_result(receipt):
    assert receipt['state'] == 'fulfilled', f'Attachment did not complete: {receipt}'
    assert receipt.get('value'), f'Attachment returned no result: {receipt}'
    return receipt['value']


def _record_operation(record, receipt):
    record['operationState'] = receipt['state']
    if 'error' in receipt:
        record['operationError'] = receipt['error']


def _runtime_target(evaluate):
    state = evaluate('sharpforge.getState()')
    debug = state['debug']
    assert debug and debug.get('uiActive'), 'The fixture must attach to an active managed application'
    scene = evaluate('sharpforge.getUIScene()')
    assert len(scene['windows']) == 1, f'Expected one exact runtime window, got {scene["windows"]}'
    window_id = scene['windows'][0]
    windows = debug.get('windows') or []
    if windows:
        matches = [window for window in windows if window.get('id') == window_id]
        assert len(matches) == 1, f'The runtime window is absent or ambiguous in the attachment descriptor: {windows}'
        title = matches[0].get('title', matches[0].get('Title', debug.get('windowTitle', 'Window')))
    else:
        # The main-worker descriptor currently reports one unnamed window rather than a window list.
        title = debug.get('windowTitle') or debug.get('title') or 'WinUI Window'
    return {'sessionId': debug['sessionId'], 'windowId': window_id,
            'generation': debug.get('generation', debug['sessionId']),
            'label': f'{state["name"]} · Session {debug["sessionId"]} · {title}',
            'runtimeIds': {node['id'] for node in scene['nodes']}}


def attach_running_application(page, evaluate, snapshot, *, records, allow_unlinked=False):
    """Choose the exact live target; capture errors/cancellation and bound each pending UI stage."""
    started = time.perf_counter()
    timeout = 25000
    original = snapshot()
    target = _runtime_target(evaluate)
    record = {key: value for key, value in target.items() if key != 'runtimeIds'}
    record.update({'originalUri': original['uri'], 'allowUnlinked': allow_unlinked, 'state': 'pending', 'stage': 'open-picker'})
    records.append(record)
    try:
        _begin_attachment(page)
        receipt, picker = _wait_for_picker_or_result(page, timeout)
        _record_operation(record, receipt)
        assert receipt['state'] == 'pending', f'Attachment settled before the application picker: {receipt}'
        assert picker['title'] == ATTACH_TITLE, f'Unexpected attachment picker: {picker}'
        assert picker['choices'].count(target['label']) == 1, f'Exact app/window choice is absent or ambiguous: {picker}'
        record['stage'] = 'select-app-window'
        page.locator('#explorer-choice').select_option(target['label'])
        page.locator('#ask-confirm').click()
        receipt, picker = _wait_for_picker_or_result(page, timeout)
        _record_operation(record, receipt)
        standalone = False
        if receipt['state'] == 'pending':
            assert allow_unlinked, f'Linked-source attachment unexpectedly needs a fallback: {picker}'
            assert picker['title'].startswith('The linked C# design cannot attach safely:'), picker
            assert picker['choices'] == [STANDALONE, KEEP_SOURCE], picker
            record['fallbackReason'] = picker['title']
            record['stage'] = 'select-unlinked-fallback'
            page.locator('#explorer-choice').select_option(STANDALONE)
            page.locator('#ask-confirm').click()
            page.wait_for_function("window.__releaseDesignerAttachment.state !== 'pending'", timeout=timeout)
            receipt = page.evaluate('window.__releaseDesignerAttachment')
            standalone = True
        _record_operation(record, receipt)
        result = _assert_result(receipt)
        record['stage'] = 'verify-attachment'
        current = snapshot()
        debug = evaluate('sharpforge.getState().debug')
        assert debug['sessionId'] == target['sessionId'], 'The runtime was replaced while its picker was open'
        assert current['live'], 'The chosen app was not attached to the active designer'
        bound = {node['runtimeId'] for node in current['document']['nodes'] if 'runtimeId' in node}
        assert bound and bound <= target['runtimeIds'], 'The attached document contains another runtime scene'
        if standalone:
            assert current['uri'] != original['uri'] and current['uri'].endswith('.sfdesign.json'), current['uri']
            assert current['sourceSync'].get('uri') is None, 'Standalone inspection retained an unauthorized source link'
        else:
            assert result['sessionId'] == target['sessionId'] and result['generation'] == target['generation'], result
            assert current['uri'] == original['uri'], 'A linked attachment replaced its source document'
        record.update({'state': 'fulfilled', 'uri': current['uri'], 'standalone': standalone,
                       'boundRuntimeIds': sorted(bound), 'sourceLinked': current['sourceSync'].get('uri') is not None})
        return record
    except Exception as error:
        record.update({'state': 'failed', 'error': str(error)})
        raise
    finally:
        record['milliseconds'] = round((time.perf_counter() - started) * 1000, 2)
