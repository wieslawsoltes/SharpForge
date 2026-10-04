"""Run the separate retained Canvas real-DOM reference using the shared production browser setup."""
import signal

from browser_designer_integrated_test import interrupted, main


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main('tests/browser_designer_canvas_translation_test.mjs', 'designer-canvas-translation-server.log'))
