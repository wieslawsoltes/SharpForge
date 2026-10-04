"""Actual explorer/session composition with OPFS, IndexedDB, BroadcastChannel and Web Locks.

The production HTTP/CSP serves real application modules. The isolated component host has no
compiler execution and does not claim locked Studio entry-point or operating-system picker coverage.
"""
import json
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir


def fixture(page, expression):
    return page.evaluate('async () => { const value = window.__a24Components; ' + expression + ' }')


def main():
    if os.getenv('SHARPFORGE_IN_MEMORY') == '1':
        raise RuntimeError('This suite requires real origin storage under production HTTP/CSP')
    checks = []
    report = {'passed': False, 'checks': checks,
        'qualification': 'Real explorer/session components; OPFS-backed File System Access; IndexedDB; BroadcastChannel; Web Locks',
        'notQualified': ['production Studio entry-point wiring', 'native filesystem picker/permission UI', 'non-Chromium engines']}
    folder_name = 'a24-components-' + uuid.uuid4().hex
    setup = (Path(__file__).parent / 'support' / 'a24-integrity-components.js').read_text(encoding='utf8')
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            context = browser.new_context(viewport={'width': 1400, 'height': 1000})
            first = context.new_page()
            load_application(first)
            first_setup = first.evaluate(setup, {'folderName': folder_name, 'initialize': True})
            row = first.locator('#a24-integrity-components [data-tree-id][data-file="A.cs"]')
            row.click()
            fixture(first, 'value.row = value.element.querySelector(\'[data-tree-id][data-file="A.cs"]\'); value.explorer.render();')
            assert fixture(first, 'return value.row === value.element.querySelector(\'[data-tree-id][data-file="A.cs"]\');')
            moved = fixture(first, """
              value.nextPath = 'Renamed.cs';
              const node = [...value.explorer.model.nodes.values()].find(node => node.path === 'A.cs');
              const result = await value.commands.run('rename', node);
              if (result?.error) throw Error(result.error);
              if (await value.physical('Renamed.cs') !== value.original) throw Error('Physical rename lost bytes');
              await value.commands.undo();
              if (await value.physical() !== value.original) throw Error('Physical undo lost bytes');
              await value.commands.redo();
              if (await value.physical('Renamed.cs') !== value.original) throw Error('Physical redo lost bytes');
              await value.commands.undo();
              return {selected: value.explorer.snapshot().selected, receipt: value.explorer.persistence.lastReceipt.status};
            """)
            checks.append({'name': 'actual keyed tree row and journal rename/undo/redo', 'passed': True, **moved})

            second = context.new_page()
            second.goto(first.url)
            second.wait_for_function('window.sharpforge && sharpforge.getState().metrics !== null')
            second_setup = second.evaluate(setup, {'folderName': folder_name, 'initialize': False})
            assert first_setup['identity'] == second_setup['identity'], (first_setup, second_setup)
            fixture(first, "value.edit('// ONE\\n// two\\n// three\\n'); await value.checkpoint();")
            fixture(second, "value.edit('// one\\n// two\\n// THREE\\n'); await value.checkpoint();")
            second.wait_for_function('window.__a24Components.explorer.persistence.conflicts.conflicts.has("A.cs")')
            assert fixture(second, 'return value.record().text;') == '// one\n// two\n// THREE\n'
            assert fixture(second, 'return value.messages.some(message => message.staleDuringMessage && '
                'message.captionDuringMessage.includes("document conflicts"));')
            result = fixture(second, 'return await value.resolve("merge");')
            assert result['status'] == 'merged', result
            assert fixture(second, 'return value.record().text;') == '// ONE\n// two\n// THREE\n'
            assert fixture(second, 'return value.state.dirtyFiles.has("A.cs") && !value.state.membershipDirty;')
            assert fixture(second, 'return await value.physical();') == '// one\n// two\n// three\n'
            first.wait_for_function('window.__a24Components.explorer.persistence.conflicts.conflicts.get("A.cs")?.remote.hash === ' +
                json.dumps(result['hash']))
            fixture(first, 'return await value.resolve("adopt-newer");')
            assert fixture(first, 'return value.record().text;') == '// ONE\n// two\n// THREE\n'
            assert fixture(first, 'return value.state.dirtyFiles.has("A.cs");')
            assert fixture(first, 'return await value.physical();') == '// one\n// two\n// three\n'
            checks.append({'name': 'native two-page channel marks stale in the receiving event and resolves unsaved buffers',
                'passed': True, 'identity': first_setup['identity'], 'resolvedHash': result['hash'], 'physicalWriteBeforeSave': False})

            fixture(first, 'await value.startBarrier();')
            fixture(first, 'value.startSave();')
            fixture(second, 'value.startSave();')
            first.wait_for_function("""async () => {
              const value = window.__a24Components;
              const key = JSON.stringify(['sharpforge-save', value.disk.saveLocks.identity, '*']);
              const locks = await navigator.locks.query();
              return locks.pending.filter(lock => lock.name === key && lock.mode === 'shared').length >= 2;
            }""")
            fixture(first, 'value.releaseBarrier(); await value.barrier;')
            for page in (first, second):
                page.wait_for_function('window.__a24Components.saveOutcome !== null')
            outcomes = [fixture(page, 'return value.saveOutcome;') for page in (first, second)]
            assert sorted(value['status'] for value in outcomes) == ['conflict', 'saved'], outcomes
            assert fixture(first, 'return await value.physical();') == '// ONE\n// two\n// THREE\n'
            checks.append({'name': 'two real Web Locks save requests against one baseline admit exactly one writer',
                'passed': True, 'outcomes': outcomes})

            winner = first if outcomes[0]['status'] == 'saved' else second
            scenarios = [
                ('merge', '// SAVED\n// two\n// THREE\n', '// ONE\n// TWO\n// THREE\n', '// SAVED\n// TWO\n// THREE\n'),
                ('keep-mine', '// mine\n', '// disk\n', '// mine\n'),
                ('take-theirs', '// discarded local\n', '// adopted disk\n', '// adopted disk\n')]
            for choice, mine, theirs, expected in scenarios:
                winner.evaluate('async value => __a24Components.stageSave(value.mine, value.theirs)', {'mine': mine, 'theirs': theirs})
                dialog = winner.get_by_role('dialog', name='Resolve Save Conflict')
                dialog.wait_for()
                dialog.get_by_label('Save conflict resolution').select_option(choice)
                dialog.get_by_role('button', name='Apply Choice', exact=True).click()
                winner.wait_for_function('window.__a24Components.saveOutcome !== null')
                outcome = fixture(winner, 'return value.saveOutcome;')
                assert outcome['status'] == 'saved', outcome
                assert fixture(winner, 'return value.record().text;') == expected
                assert fixture(winner, 'return await value.physical();') == expected
                assert not fixture(winner, 'return value.state.dirtyFiles.has("A.cs");')
            checks.append({'name': 'real save-conflict dialog keep-mine/take-theirs/merge and physical hash revalidation', 'passed': True})
            winner.evaluate('async () => __a24Components.stageSave("// retained local\\n", "// retained disk\\n")')
            winner.get_by_role('dialog', name='Resolve Save Conflict').get_by_role('button', name='Cancel', exact=True).click()
            winner.wait_for_function('window.__a24Components.saveOutcome !== null')
            assert fixture(winner, 'return value.record().text;') == '// retained local\n'
            assert fixture(winner, 'return await value.physical();') == '// retained disk\n'
            assert fixture(winner, 'return value.state.dirtyFiles.has("A.cs");')
            checks.append({'name': 'save choice cancellation retains local dirty text and the observed physical version', 'passed': True})

            recovery = fixture(winner, 'return await value.recovery();')
            assert recovery['snapshots'] >= 2, recovery
            checks.append({'name': 'real OPFS checkpoint retains binary and unopened membership; IndexedDB recent handle reopens',
                'passed': True, **recovery})
            quarantine = fixture(winner, 'return await value.quarantine();')
            checks.append({'name': 'real OPFS corruption quarantine and previous-generation recovery', 'passed': True, **quarantine})
            for page in (first, second):
                assert not fixture(page, 'return value.errors;'), fixture(page, 'return value.errors;')
            report['browserVersion'] = browser.version
            for page in (first, second):
                fixture(page, 'await value.dispose();')
            first.evaluate('async name => (await navigator.storage.getDirectory()).removeEntry(name, {recursive:true})', folder_name)
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        destination = results_dir() / 'a24-integrity-components-results.json'
        destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
