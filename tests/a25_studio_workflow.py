"""Actual built Studio interactions and independent reads through its production Git worker."""
import json
import re
import time
import traceback

from browser_harness import load_application, wait_condition
from a25_studio_observers import observe_commit_indicator, highlight_work_coverage
from a25_studio_blame import qualify_blame_scroll


BASE = 'using System;\nclass Program {\n  static void Main() {\n    Console.WriteLine("base");\n  }\n}\n'
EDITED = BASE.replace('"base"', '"working"')
WORKING = EDITED + '// keep this line unstaged\n'
FEATURE = WORKING.replace('"working"', '"feature"')
MAIN = WORKING.replace('"working"', '"main"')

READ_REPOSITORY = """async () => {
    const saved = JSON.parse(localStorage.getItem('sharpforge.git.repositories.v1'))?.repositories;
    if (!Array.isArray(saved) || saved.length !== 1) throw new Error('Expected one isolated fixture repository');
    const repository = saved[0];
    const { GitWorkerClient } = await __sharpforgeTestImport('/packages/git/src/index.js');
    const worker = new Worker(new URL('./git-worker.js', location.href), {type: 'module'});
    const client = new GitWorkerClient(worker);
    const request = (method, params = {}) => client.request(method, {repositoryId: repository.repositoryId, ...params});
    try {
        const opened = await request('open', repository);
        const head = await request('head');
        const status = await request('status');
        const log = await request('log', {all: true, maxCount: 30});
        const branches = await request('branches');
        const versions = await request('fileVersions', {path: 'Program.cs'});
        const conflict = status.some(change => change.path === 'Program.cs' && change.conflict)
            ? await request('conflict', {path: 'Program.cs'}) : null;
        return {opened, head, status, branches, versions, conflict,
            log: log.map(({oid, tree, parents, message, author}) => ({oid, tree, parents, message, author}))};
    } finally {
        try { await client.dispose(); }
        finally { worker.terminate(); }
    }
}"""


def require(value, message):
    if not value:
        raise AssertionError(message)


class StudioWorkflow:
    def __init__(self, page, session, report, output):
        self.page, self.session, self.report, self.output = page, session, report, output
        self.initial_head = None
        self.common_head = None
        self.feature_head = None
        self.main_head = None
        self.final_head = None

    def check(self, name, operation):
        self.session.check_cancelled()
        started = time.monotonic()
        print(json.dumps({"state": "running", "case": name}), flush=True)
        try:
            result = operation()
            self.report["checks"].append({"name": name, "passed": True, "result": result,
                                          "elapsedMs": (time.monotonic() - started) * 1000})
            print(json.dumps({"state": "passed", "case": name}), flush=True)
        except BaseException:
            self.report["checks"].append({"name": name, "passed": False, "error": traceback.format_exc(),
                                          "elapsedMs": (time.monotonic() - started) * 1000})
            raise

    def open_tool(self, name):
        self.page.evaluate("name => sharpforge.openTool(name)", name)
        tool = self.page.locator(f'[data-tool="{name}"]')
        tool.wait_for(state="visible", timeout=30000)
        wait_condition(self.page, """() => [...document.querySelectorAll('[data-tool].git-tool')]
            .filter(element => element.getBoundingClientRect().height > 0)
            .every(element => element.getAttribute('aria-busy') !== 'true')""")
        return tool

    def idle(self):
        wait_condition(self.page, """() => {
            const cancel = document.querySelector('[data-git-cancel]');
            return cancel?.disabled && !document.querySelector('.git-status-indicator')?.textContent.includes('Working');
        }""", timeout=60000)

    def refresh(self):
        tool = self.open_tool("git-changes")
        tool.get_by_role("button", name="Refresh", exact=True).click()
        self.idle()
        return tool

    def snapshot(self):
        self.idle()
        value = self.page.evaluate(READ_REPOSITORY)
        require(value["opened"]["backend"] == "indexeddb", "Studio did not use actual IndexedDB")
        return value

    def edit(self, text, save=True):
        self.page.evaluate('sharpforge.openFile("Program.cs")')
        self.replace_editor_text(text)
        if save:
            self.page.evaluate('sharpforge.execute("save")')
        self.refresh()
        deadline = time.monotonic() + 30
        while self.snapshot()["versions"]["working"]["text"] != text:
            require(time.monotonic() < deadline, "Studio did not synchronize the edited buffer to the worker")
            self.page.wait_for_timeout(20)

    def replace_editor_text(self, text):
        source = self.page.locator('[data-source-uri="Program.cs"] .sf-input')
        # Native editors own the model selection; their textarea holds only bounded input context.
        source.focus()
        source.press("ControlOrMeta+a")
        selected = source.evaluate("""input => ({
            start: input.selectionStart, end: input.selectionEnd, length: input.value.length
        })""")
        require(selected["start"] == 0 and selected["end"] == selected["length"],
                "Select All did not select the complete editor model")
        self.page.keyboard.insert_text(text)
        require(self.editor_text() == text, "Editor change did not reach the workspace model")

    def editor_text(self):
        return self.page.evaluate('sharpforge.getState().files.find(file => file.uri === "Program.cs").text')

    def stage_all(self):
        tool = self.open_tool("git-changes")
        tool.get_by_role("button", name="Stage All", exact=True).click()
        self.idle()
        tool.get_by_role("heading", name="Staged Changes (1)", exact=True).wait_for()

    def commit(self, message, measure_status=False):
        tool = self.open_tool("git-changes")
        tool.get_by_role("textbox", name="Commit message", exact=True).fill(message)
        button = tool.get_by_role("button", name="Commit Staged", exact=True)
        observer = observe_commit_indicator(button, "⑂ main", "main: 0 changed files; open Git Changes to sync") if measure_status else None
        try:
            button.click()
            self.idle()
            tool.get_by_role("heading", name="Staged Changes (0)", exact=True).wait_for()
            if observer:
                timing = observer.evaluate("async observer => await observer.done")
                self.report.setdefault("commitStatusTimings", []).append({"message": message, **timing})
                require(timing["outcome"] == "updated" and timing["trusted"], "Commit status did not follow the trusted button event")
                require(timing["elapsedMs"] <= 500,
                        f"Commit click to status update took {timing['elapsedMs']:.3f} ms, exceeding the 500 ms acceptance bound")
        finally:
            if observer:
                try:
                    observer.evaluate("observer => observer.dispose()")
                finally:
                    observer.dispose()
        value = self.snapshot()
        committed = next(commit for commit in value["log"] if commit["oid"] == value["head"]["oid"])
        require(committed["message"].strip() == message, "Commit message was not persisted in a real Git object")
        return value

    def screenshot(self, suffix):
        path = self.output.with_name(self.output.stem + "-" + suffix + ".png")
        self.page.screenshot(path=str(path), full_page=True)
        self.report["screenshots"].append(str(path))

    def initialize(self):
        load_application(self.page)
        self.report["studioUrl"] = self.page.url
        self.page.evaluate('sharpforge.execute("stop")')
        self.page.evaluate('text => sharpforge.loadDiskRecords([{path: "Program.cs", text}], {name: "GitAcceptance"})', BASE)
        require(self.editor_text() == BASE, "Studio did not load the actual fixture workspace")
        require(not any(url.endswith("/git-worker.js") for url in self.report["workers"]),
                "Git started eagerly before the first Git action")
        settings = self.open_tool("git-settings")
        settings.get_by_label("Commit author name", exact=True).fill("Git Acceptance")
        settings.get_by_label("Commit author email", exact=True).fill("acceptance@example.invalid")
        settings.get_by_role("button", name="Save Git settings", exact=True).click()
        settings.get_by_role("status").filter(has_text="Git settings saved").wait_for()
        self.open_tool("git-changes").get_by_role("button", name="Initialize", exact=True).click()
        dialog = self.page.get_by_role("dialog", name="Initialize Repository", exact=True)
        dialog.get_by_label("Repository name", exact=True).fill("GitAcceptance")
        dialog.get_by_label("Default branch", exact=True).fill("main")
        dialog.get_by_label("Object format", exact=True).select_option("sha1")
        dialog.get_by_role("button", name="Initialize", exact=True).click()
        dialog.wait_for(state="hidden")
        self.idle()
        self.page.get_by_role("heading", name="Changes (1)", exact=True).wait_for()
        require(any(url.endswith("/git-worker.js") for url in self.report["workers"]),
                "The built Studio did not start an actual Git worker")
        value = self.snapshot()
        require(value["head"] == {"ref": "refs/heads/main", "oid": None}, "Initialized HEAD is not an unborn main branch")
        require(value["versions"]["working"]["text"] == BASE, "Worker did not receive the actual workspace bytes")
        self.screenshot("initialized")
        return {"opened": value["opened"], "head": value["head"], "changes": value["status"]}

    def initial_commit(self):
        self.stage_all()
        value = self.commit("Initial browser commit", measure_status=True)
        self.initial_head = value["head"]["oid"]
        require(value["versions"]["base"]["text"] == BASE, "Initial commit tree contains different bytes")
        require(not any(change.get("staged") or change.get("worktreeStatus") != "." for change in value["status"]),
                "Initial commit left actual file changes")
        return {"head": self.initial_head, "commits": len(value["log"]), "status": value["status"]}

    def partial_stage(self):
        self.edit(WORKING)
        tool = self.open_tool("git-changes")
        tool.get_by_role("list", name="Changes", exact=True).get_by_role("button", name="Program.cs", exact=True).click()
        diff = self.open_tool("git-diff")
        source_versions = self.readonly_source_versions(diff, BASE, WORKING)
        diff.locator('.git-diff-row').filter(has_text='Console.WriteLine("base")').get_by_role("checkbox").check()
        diff.locator('.git-diff-row').filter(has_text='Console.WriteLine("working")').get_by_role("checkbox").check()
        diff.get_by_role("button", name="Stage Selected Lines", exact=True).click()
        self.idle()
        value = self.snapshot()
        require(value["versions"]["index"]["text"] == EDITED, "Selected lines did not produce the exact staged blob")
        require(value["versions"]["working"]["text"] == WORKING, "Partial staging modified the working file")
        require(value["head"]["oid"] == self.initial_head, "Staging unexpectedly moved HEAD")
        self.screenshot("partial-diff")
        return {"head": value["head"], "indexText": value["versions"]["index"]["text"],
                "workingText": value["versions"]["working"]["text"], "sourceVersions": source_versions}

    def readonly_source_versions(self, diff, before_text, after_text):
        inspector = diff.locator('details.git-source-inspector')
        inspector.get_by_text("Read-only source versions", exact=True).click()
        for side in ("before", "after"):
            inspector.get_by_label(f"Read-only {side} source", exact=True).wait_for(state="attached")
        # Model loading precedes the property assertion: checking only the initially empty editor
        # would miss setModel replacing the model and clearing its read-only state.
        self.page.wait_for_function("""expected => ['before', 'after'].every(side => {
            const input = document.querySelector('.git-source-inspector textarea[aria-label="Read-only ' + side + ' source"]');
            return input && input.value === expected[side];
        })""", arg={"before": before_text, "after": after_text})
        models = inspector.locator('textarea.sf-input').evaluate_all("""inputs => inputs.map(input => ({
            label: input.getAttribute('aria-label'), tag: input.tagName, readOnly: input.readOnly, value: input.value
        }))""")
        require(len(models) == 2 and all(model["tag"] == "TEXTAREA" and model["readOnly"] is True for model in models),
                "Loaded comparison source models must both preserve the native textarea readOnly property")
        require({model["label"]: model["value"] for model in models} == {
            "Read-only before source": before_text, "Read-only after source": after_text
        }, "Read-only source versions did not load the actual before/after blobs")
        self.screenshot("readonly-versions")
        inspector.locator('summary').click()
        return models

    def unstage_and_commit(self):
        self.open_tool("git-changes").get_by_role("button", name="Unstage All", exact=True).click()
        self.idle()
        value = self.snapshot()
        require(value["versions"]["index"]["text"] == BASE, "Unstage did not restore the HEAD blob in the index")
        require(self.editor_text() == WORKING, "Unstage modified the editor buffer")
        self.stage_all()
        value = self.commit("Stage complete working change")
        self.common_head = value["head"]["oid"]
        require(value["versions"]["base"]["text"] == WORKING, "Complete commit omitted the previously unstaged line")
        return {"head": self.common_head, "parents": value["log"][0]["parents"]}

    def switch_branch(self, name, reject=False):
        self.page.evaluate('sharpforge.execute("git.branch")')
        dialog = self.page.get_by_role("dialog", name="Switch Branch", exact=True)
        dialog.get_by_label("Branch", exact=True).select_option("refs/heads/" + name)
        dialog.get_by_role("button", name="Switch", exact=True).click()
        if reject:
            alert = dialog.get_by_role("alert")
            alert.filter(has_text=re.compile("dirty|overwrit|changes|modif", re.I)).wait_for()
            message = alert.inner_text()
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            dialog.wait_for(state="hidden")
            self.idle()
            return message
        dialog.wait_for(state="hidden")
        self.idle()
        value = self.snapshot()
        require(value["head"]["ref"] == "refs/heads/" + name, "Branch switch did not update symbolic HEAD")
        return value

    def branch_and_dirty_guard(self):
        self.page.evaluate('sharpforge.execute("git.createBranch")')
        dialog = self.page.get_by_role("dialog", name="Create Branch", exact=True)
        dialog.get_by_label("Branch name", exact=True).fill("feature")
        dialog.get_by_label("Start revision", exact=True).fill("HEAD")
        dialog.get_by_role("checkbox", name="Switch to new branch", exact=True).check()
        dialog.get_by_role("button", name="Create Branch", exact=True).click()
        dialog.wait_for(state="hidden")
        self.idle()
        value = self.snapshot()
        require(value["head"] == {"ref": "refs/heads/feature", "oid": self.common_head},
                "Create Branch did not create and switch the actual ref")
        self.edit(FEATURE)
        self.stage_all()
        self.feature_head = self.commit("Feature changes shared line")["head"]["oid"]
        self.switch_branch("main")
        require(self.editor_text() == WORKING, "Switch to main did not restore the main tree in Studio")
        self.edit(MAIN, save=False)
        message = self.switch_branch("feature", reject=True)
        value = self.snapshot()
        require(value["head"] == {"ref": "refs/heads/main", "oid": self.common_head},
                "Rejected dirty checkout changed HEAD")
        require(self.editor_text() == MAIN and value["versions"]["working"]["text"] == MAIN,
                "Rejected dirty checkout lost editor or worktree changes")
        self.page.evaluate('sharpforge.execute("save")')
        self.stage_all()
        value = self.commit("Main changes shared line")
        self.main_head = value["head"]["oid"]
        return {"featureHead": self.feature_head, "mainHead": self.main_head, "rejection": message,
                "branches": value["branches"]}

    def merge_conflict(self):
        self.page.evaluate('sharpforge.execute("git.merge")')
        dialog = self.page.get_by_role("dialog", name="Merge Branch", exact=True)
        dialog.get_by_label("Revision to merge", exact=True).select_option("refs/heads/feature")
        dialog.get_by_role("button", name="Merge", exact=True).click()
        dialog.wait_for(state="hidden")
        self.idle()
        tool = self.open_tool("git-changes")
        tool.get_by_role("heading", name="Conflicts (1)", exact=True).wait_for()
        value = self.snapshot()
        require(value["head"]["oid"] == self.main_head, "Conflicted merge moved HEAD before resolution")
        require(value["conflict"]["base"]["text"] == WORKING, "Merge conflict lost the actual common ancestor")
        require(value["conflict"]["ours"]["text"] == MAIN and value["conflict"]["theirs"]["text"] == FEATURE,
                "Merge conflict index does not preserve the real branch sides")
        tool.get_by_role("list", name="Conflicts", exact=True).get_by_role("button", name="Program.cs", exact=True).click()
        merge = self.open_tool("git-merge")
        merge.get_by_role("textbox", name="Resolved content", exact=True).wait_for()
        self.screenshot("merge-conflict")
        return {"head": value["head"], "status": value["status"], "conflict": value["conflict"]}

    def resolve_and_commit(self):
        merge = self.open_tool("git-merge")
        markers = '<<<<<<< ours\nkeep ours\n=======\nkeep theirs\n>>>>>>> theirs\n'
        merge.get_by_role("textbox", name="Resolved content", exact=True).fill(markers)
        merge.get_by_role("button", name="Mark Resolved", exact=True).click()
        self.page.get_by_text("Remove conflict markers before staging the resolution", exact=True).wait_for()
        self.idle()
        rejected = self.snapshot()
        require(rejected["conflict"] is not None, "Unresolved markers were staged as a successful resolution")
        require(rejected["head"]["oid"] == self.main_head, "Rejected marker resolution moved HEAD")
        merge.get_by_role("button", name="Accept Incoming", exact=True).click()
        require(merge.get_by_role("textbox", name="Resolved content", exact=True).input_value() == FEATURE,
                "Accept Incoming did not choose the actual incoming blob")
        merge.get_by_role("button", name="Mark Resolved", exact=True).click()
        self.idle()
        self.open_tool("git-changes").get_by_role("heading", name="Staged Changes (1)", exact=True).wait_for()
        value = self.snapshot()
        require(value["conflict"] is None and value["versions"]["index"]["text"] == FEATURE,
                "Conflict resolution did not replace the staged conflict entries")
        require(self.editor_text() == FEATURE, "Resolved bytes were not adopted by the Studio editor")
        value = self.commit("Resolve feature merge")
        self.final_head = value["head"]["oid"]
        committed = next(commit for commit in value["log"] if commit["oid"] == self.final_head)
        require(committed["parents"] == [self.main_head, self.feature_head], "Resolved merge is not a real two-parent commit")
        require(value["versions"]["base"]["text"] == FEATURE, "Merge commit contains the wrong resolved blob")
        self.page.evaluate('sharpforge.execute("save")')
        self.refresh()
        merge.get_by_role("heading", name="No unresolved conflict", exact=True, include_hidden=True).wait_for(state="attached")
        require(not self.page.get_by_text("Path has no unresolved index stages", exact=True).count(),
                "Successful conflict resolution and refresh produced an unexpected stale conflict-detail error")
        return {"head": self.final_head, "parents": committed["parents"], "status": value["status"]}

    def historical_diff_and_blame(self):
        history = self.open_tool("git-repository")
        history.locator('.git-history-row').filter(has_text="Initial browser commit").click()
        history.locator('.git-commit-detail .git-path').filter(has_text="Program.cs").click()
        diff = self.open_tool("git-diff")
        diff.locator('.git-diff-row').filter(has_text='Console.WriteLine("base")').wait_for()
        require(not diff.get_by_role("button", name="Stage Selected Lines", exact=True).count(),
                "Historical diff offers to modify the current index")
        diff.get_by_role("button", name="Blame", exact=True).click()
        diff.locator('.git-blame-row').first.wait_for()
        blame = diff.locator('.git-blame-viewport').inner_text()
        require('Console.WriteLine("base")' in blame, "Blame did not use the selected historical blob")
        require(self.editor_text() == FEATURE, "Reading historical diff or blame overwrote the active editor")
        value = self.snapshot()
        require(value["head"]["oid"] == self.final_head, "Historical inspection changed HEAD")
        self.screenshot("historical-blame")
        return {"head": value["head"], "blame": blame, "liveBlameRows": diff.locator('.git-blame-row').count()}

    def blame_margin_without_retokenizing(self):
        self.page.evaluate('sharpforge.openFile("Program.cs")')
        source = self.page.locator('[data-source-uri="Program.cs"] .sf-input')
        source.wait_for(state="visible")
        expected = self.editor_text()
        profiler = self.page.context.new_cdp_session(self.page)
        profiler.send("Profiler.enable")
        try:
            profiler.send("Profiler.startPreciseCoverage", {"callCount": True, "detailed": True})
            # A real input positive control proves this native profiler sees the production lexer path.
            self.replace_editor_text(expected + '// native coverage positive control\n')
            self.replace_editor_text(expected)
            self.page.evaluate('sharpforge.execute("save")')
            self.refresh()
            before = self.page.evaluate('sharpforge.getEditorState("Program.cs")')
            control = highlight_work_coverage(profiler.send("Profiler.takePreciseCoverage"))
            evidence = {"scope": "native Chromium main-isolate precise coverage", "positiveControl": control,
                        "before": before["highlight"], "toggles": []}
            self.report["blameRetokenization"] = evidence
            require(before["highlight"]["syntax"] and before["highlight"]["totalTokens"] > 0,
                    "The actual source editor did not have syntax highlighting enabled")
            edit_control = [row for row in control if row["operation"] == "update" and row["calls"] > 0]
            if not edit_control:
                edit_control = [row for row in control if row["operation"] == "constructor" and row["calls"] > 0]
            require(len(edit_control) == 1 and edit_control[0]["calls"] >= 2,
                    "Native coverage did not observe SyntaxHighlightIndex creation or update for both real source changes")
            identity_keys = ("url", "scriptId", "function", "startOffset", "endOffset", "backend", "operation", "observedRoutine")
            targets = [{key: row[key] for key in identity_keys} for row in control]
            evidence["target"] = {key: edit_control[0][key] for key in identity_keys}
            evidence["targets"] = targets
            evidence["backend"] = edit_control[0]["backend"]
            # takePreciseCoverage resets execution counters, isolating each toggle from the positive control.
            for enabled in (True, False):
                self.page.evaluate('sharpforge.execute("git.blameMargin")')
                margin = self.page.locator('[data-source-uri="Program.cs"] .git-blame-margin')
                if enabled:
                    margin.locator('.git-blame-margin-row').first.wait_for(state="visible")
                else:
                    margin.wait_for(state="detached")
                after = self.page.evaluate('sharpforge.getEditorState("Program.cs")')
                coverage = highlight_work_coverage(profiler.send("Profiler.takePreciseCoverage"))
                measured = {"enabled": enabled, "highlightWorkCalls": sum(row["calls"] for row in coverage),
                            "constructorCalls": sum(row["calls"] for row in coverage if row["operation"] == "constructor"),
                            "updateCalls": sum(row["calls"] for row in coverage if row["operation"] == "update"),
                            "coverage": coverage, "highlight": after["highlight"],
                            "visibleRows": margin.locator('.git-blame-margin-row').count()}
                evidence["toggles"].append(measured)
                require(all({key: row[key] for key in identity_keys} in targets for row in coverage),
                        "A loaded highlighting routine changed during the measured toggle")
                require(measured["highlightWorkCalls"] == 0, "Toggling the blame margin retokenized the source document")
                require(after["value"] == expected and after["start"] == before["start"] and after["end"] == before["end"],
                        "Toggling the blame margin changed the source or selection")
                require(after["highlight"]["totalTokens"] == before["highlight"]["totalTokens"],
                        "Toggling the blame margin changed the editor's actual token inventory")
            return evidence
        finally:
            try:
                profiler.send("Profiler.stopPreciseCoverage")
                profiler.send("Profiler.disable")
            finally:
                profiler.detach()

    def reload_repository(self):
        repository_id = self.snapshot()["opened"]["repositoryId"]
        self.page.reload(wait_until="load")
        wait_condition(self.page, 'window.sharpforge && sharpforge.getState().metrics !== null')
        tool = self.open_tool("git-changes")
        tool.get_by_role("combobox", name="Git repository", exact=True).select_option(repository_id)
        self.idle()
        tool.get_by_role("button", name="⑂ main", exact=True).wait_for()
        value = self.snapshot()
        require(value["head"]["oid"] == self.final_head, "Repository reload did not preserve committed HEAD")
        require(value["versions"]["base"]["text"] == FEATURE and self.editor_text() == FEATURE,
                "Repository reload did not restore the committed workspace bytes")
        self.report["studioReloaded"] = True
        self.open_tool("git-repository").locator('.git-history-row').filter(has_text="Resolve feature merge").wait_for()
        self.screenshot("reloaded-history")
        return {"head": value["head"], "commits": len(value["log"]), "opened": value["opened"]}

    def run(self):
        for name, operation in [
            ("studio-lazy-worker-init-identity", self.initialize),
            ("studio-stage-and-native-object-commit", self.initial_commit),
            ("studio-diff-partial-line-stage", self.partial_stage),
            ("studio-unstage-and-complete-commit", self.unstage_and_commit),
            ("studio-branch-and-dirty-checkout-refusal", self.branch_and_dirty_guard),
            ("studio-real-merge-conflict-index", self.merge_conflict),
            ("studio-marker-refusal-resolution-merge-commit", self.resolve_and_commit),
            ("studio-historical-root-diff-and-blame", self.historical_diff_and_blame),
            ("studio-blame-margin-native-no-retokenization", self.blame_margin_without_retokenizing),
            ("studio-blame-margin-native-scroll-geometry", lambda: qualify_blame_scroll(self)),
            ("studio-indexeddb-reload-history", self.reload_repository)
        ]:
            self.check(name, operation)
