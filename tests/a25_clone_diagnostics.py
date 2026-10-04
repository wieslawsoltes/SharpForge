"""Observe clone completion without confusing an old alert or in-flight progress with a new failure."""
from contextlib import contextmanager

from browser_harness import wait_condition


ARM_SUBMISSION = """dialog => {
    if (globalThis.__sharpforgeCloneSubmission) throw new Error('A clone submission is already observed');
    const status = dialog.querySelector('[role="alert"]');
    const submit = dialog.querySelector('button[type="submit"]');
    if (!status || !submit) throw new Error('Clone dialog has no submission status');
    const state = {dialog, status, submit, changed: false};
    state.observer = new MutationObserver(() => { state.changed = true; });
    state.observer.observe(status, {childList: true, characterData: true, subtree: true});
    globalThis.__sharpforgeCloneSubmission = state;
}"""

WAIT_SUBMISSION = """() => {
    const state = globalThis.__sharpforgeCloneSubmission;
    if (!state) throw new Error('No clone submission is observed');
    if (!state.dialog.isConnected || !state.dialog.open) return {state: 'closed'};
    if (__AUTHENTICATION__ && document.querySelector('dialog[aria-label="Git authentication"][open]')) {
        return {state: 'authentication'};
    }
    const message = state.status.textContent.trim();
    if (state.changed && !state.submit.disabled && message) return {state: 'error', message};
    return false;
}"""


@contextmanager
def clone_submission(page, dialog):
    """Keep the real 120-second network deadline, but surface a completed failed submission immediately."""
    dialog.evaluate(ARM_SUBMISSION)

    def wait(*, authentication=False):
        predicate = WAIT_SUBMISSION.replace('__AUTHENTICATION__', 'true' if authentication else 'false')
        outcome = wait_condition(page, predicate, timeout=120000)
        if outcome['state'] == 'error':
            raise AssertionError('Clone Repository failed: ' + outcome['message'])
        if authentication and outcome['state'] != 'authentication':
            raise AssertionError('Private clone completed without its expected authentication challenge')
        return outcome

    try:
        dialog.get_by_role('button', name='Clone', exact=True).click()
        yield wait
    finally:
        if not page.is_closed():
            page.evaluate("""() => {
                globalThis.__sharpforgeCloneSubmission?.observer.disconnect();
                delete globalThis.__sharpforgeCloneSubmission;
            }""")
