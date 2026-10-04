"""Bounded startup evidence from public workbench owners; never replaces a failed assertion."""


def capture_startup(page, observation):
    try:
        observation['startup'] = page.evaluate('''() => {
            const services = window.sharpforge?.workbenchServices;
            const cleanUrl = value => {
                if (value.startsWith('blob:')) return 'blob:' + cleanUrl(value.slice(5));
                try {
                    const url = new URL(value);
                    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
                    return url.href;
                } catch { return value.split(/[?#]/, 1)[0]; }
            };
            const text = value => typeof value === 'string' ? value.slice(0, 16384)
                .replace(/(?:blob:)?(?:https?|file):\\/\\/[^\\s'"<>)}\\]]+/g, cleanUrl) : '';
            const url = new URL(location.href);
            url.username = ''; url.password = ''; url.search = ''; url.hash = '';
            const failure = error => error ? {
                name: text(error.name), code: text(error.code), message: text(error.message), stack: text(error.stack),
                worker: error.worker ?? null,
                cause: error.cause ? {name: text(error.cause.name), message: text(error.cause.message),
                    stack: text(error.cause.stack), worker: error.cause.worker ?? null} : null
            } : null;
            const worker = owner => ({id: text(owner.id), failed: owner.worker.failed,
                generation: owner.worker.generation, error: failure(owner.worker.lastError)});
            return {url: url.href, origin: location.origin,
                compiler: (services?.builds.list() ?? []).slice(0, 64).map(worker),
                runtime: (services?.sessions.list() ?? []).slice(0, 64).map(worker),
                status: text(document.querySelector('#status-message')?.textContent?.slice(0, 4096))};
        }''')
    except Exception as error:
        observation['startupDiagnosticError'] = type(error).__name__ + ': startup diagnostic collection failed'
