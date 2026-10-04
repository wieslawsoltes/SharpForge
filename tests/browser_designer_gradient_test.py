"""Qualify portable gradient paint against the already-built production Studio and shipped CSP."""
import signal

from browser_designer_integrated_test import interrupted, main


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main('tests/browser_designer_gradient_test.mjs', 'designer-gradient-server.log'))
