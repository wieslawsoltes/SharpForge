"""CSP observations from the browser, without modifying the application's policy."""
import re

class CspViolation(AssertionError):
    pass

class CspMonitor:
    def __init__(self):
        self.events = []

    def attach(self, context):
        context.expose_binding('__sharpforgeCspViolation', lambda source, value: self.events.append({'source': 'event', **value}))
        context.add_init_script("""addEventListener('securitypolicyviolation', e => {
          globalThis.__sharpforgeCspViolation({directive:e.effectiveDirective, blockedURI:e.blockedURI,
            disposition:e.disposition, documentURI:e.documentURI, policy:e.originalPolicy});
        });""")
        context.on('page', self.page)

    def page(self, page):
        def console(message):
            if message.type in ('error', 'warning') and re.search(r'content.security.policy|violat.*(?:script-src|style-src|worker-src)|refused to (?:execute|load|connect)', message.text, re.I):
                self.events.append({'source': 'console', 'message': message.text, 'url': page.url})
        page.on('console', console)

    def assert_clean(self):
        if self.events:
            raise CspViolation('Browser CSP violations: ' + repr(self.events))
