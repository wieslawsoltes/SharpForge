"""Read-only native browser observations; no product method or lexer is replaced."""
from urllib.parse import urlsplit


def observe_commit_indicator(button, text, title):
    """Time the trusted input event and matching production DOM mutation in one browser clock."""
    return button.evaluate_handle("""(button, expected) => {
        const indicator = document.querySelector('.git-status-indicator');
        if (!indicator) throw new Error('The production Git status indicator is missing');
        let started = null, timer, resolve, settled = false, trusted = false;
        const initialText = indicator.textContent;
        const done = new Promise(complete => { resolve = complete; });
        const observer = new MutationObserver(() => {
            if (started !== null && indicator.textContent === expected.text && indicator.title === expected.title) finish('updated');
        });
        const finish = outcome => {
            if (settled) return;
            settled = true;
            const completed = performance.now();
            observer.disconnect();
            button.removeEventListener('click', clicked, true);
            clearTimeout(timer);
            resolve({outcome, trusted, started, completed, elapsedMs: started === null ? null : completed - started,
                initialText, text: indicator.textContent, title: indicator.title,
                interval: 'trusted Commit Staged click to clean branch indicator DOM mutation', limitMs: 500});
        };
        const clicked = event => {
            started = performance.now();
            trusted = event.isTrusted;
            timer = setTimeout(() => finish('timeout'), 5000);
        };
        observer.observe(indicator, {childList: true, characterData: true, subtree: true, attributes: true});
        button.addEventListener('click', clicked, {capture: true, once: true});
        return {done, dispose: () => finish('disposed')};
    }""", {"text": text, "title": title})


def highlight_work_coverage(snapshot):
    """Observe native constructor/relex entry points for both supported editor layouts.

    Legacy editors rebuild SyntaxHighlightIndex in highlight.js for each source edit.
    Incremental editors reexport that class from view/syntax-index.js and call update().
    Observe both creation and update so a toggle cannot hide a full index replacement.
    Counts come from each function's outer CDP range, never its nested branch ranges.
    """
    observations = []
    for script in snapshot["result"]:
        path = urlsplit(script["url"]).path
        if path.endswith('/packages/editor/src/view/syntax-index.js'):
            backend = 'incremental-syntax-index'
        elif path.endswith('/packages/editor/src/highlight.js'):
            backend = 'legacy-syntax-index'
        else:
            continue
        for function in script["functions"]:
            name = function["functionName"]
            if name in ('SyntaxHighlightIndex', 'constructor'):
                operation = 'constructor'
            elif backend == 'incremental-syntax-index' and name == 'update':
                operation = 'update'
            else:
                continue
            if not function["ranges"]:
                continue
            outer = max(function["ranges"], key=lambda value: value["endOffset"] - value["startOffset"])
            observations.append({"url": script["url"], "scriptId": script["scriptId"],
                                 "function": name, "startOffset": outer["startOffset"],
                                 "endOffset": outer["endOffset"], "calls": outer["count"],
                                 "backend": backend, "operation": operation,
                                 "observedRoutine": 'SyntaxHighlightIndex.' + operation})
    return observations
