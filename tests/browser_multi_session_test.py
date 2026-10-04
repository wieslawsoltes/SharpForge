"""A19: actual Studio projects, toolbar launches, and isolated application workers.

Run after the completed scope's production build. No replacement workbench, mock
workers, injected app host, or in-memory Blob loader participates in this suite.
"""
import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir, selected_engine


ALPHA = "Alpha/Alpha.csproj"
BETA = "Beta/Beta.csproj"
PROJECTS = (ALPHA, BETA)
ROOT = Path(__file__).resolve().parents[1]
WINDOW_SOURCE = (ROOT / "tests/fixtures/a19/multi-session/WindowProgram.cs").read_text(encoding="utf8")


def require(value, message):
    if not value:
        raise AssertionError(message)


def workspace_records():
    project = ('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
               '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>')
    records = [{"path": "TwoApps.slnx", "text": '<Solution><Project Path="Alpha/Alpha.csproj"/>'
                '<Project Path="Beta/Beta.csproj"/></Solution>'}]
    for name in ("Alpha", "Beta"):
        records.extend([
            {"path": f"{name}/{name}.csproj", "text": project},
            {"path": f"{name}/Program.cs", "text": WINDOW_SOURCE.replace("APP_NAME", name)
             .replace("APP_OUTPUT", name.lower() + "-output")},
        ])
    return records


def prepare_studio(page, checks):
    load_application(page)
    wait_condition(page, "!!sharpforge.workbenchShell && !!sharpforge.workbenchServices")
    page.evaluate("""async () => {
        for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
        }
    }""")
    loaded = page.evaluate("""async records => {
        const result = await sharpforge.loadDiskRecords(records, {
            entry: 'TwoApps.slnx', startup: 'Alpha/Alpha.csproj', name: 'TwoApps'
        });
        const services = sharpforge.workbenchServices;
        return {projectIds: result.projects.map(project => project.path),
            builds: services.builds.list().map(service => service.id),
            memberships: Object.fromEntries([...services.documents.projectMembership]
                .map(([id, uris]) => [id, [...uris]]))};
    }""", workspace_records())
    require(sorted(loaded["projectIds"]) == sorted(PROJECTS), "Studio did not load both real projects")
    require(sorted(loaded["builds"]) == sorted(PROJECTS), "Studio compiler services do not match the solution")
    require(loaded["memberships"][ALPHA] == ["Alpha/Program.cs"], "Alpha compilation includes another project's source")
    require(loaded["memberships"][BETA] == ["Beta/Program.cs"], "Beta compilation includes another project's source")
    checks.append({"name": "solution import uses Studio project and compiler services", "passed": True})


def configure_profiles(page, checks):
    page.evaluate("""projects => {
        const services = sharpforge.workbenchServices;
        for (const projectId of projects) {
            const name = projectId.split('/')[0].toLowerCase();
            services.profiles.set(projectId, {id: 'default', name: 'Default', renderer: 'dom',
                arguments: ['wrong-default-profile'], environment: {APP_ENV: 'wrong-default-environment'}});
            services.profiles.set(projectId, {id: name + '-selected', name: name + ' selected', renderer: 'dom',
                arguments: [name + ' argument 雪'], environment: {APP_ENV: name + ' environment'}, stopOnEntry: false});
        }
    }""", PROJECTS)
    target = page.locator('.sf-startup-target select[aria-label="Startup target"]')
    profile = page.locator('.sf-startup-target select[aria-label="Launch profile"]')
    target.select_option(ALPHA)
    profile.select_option("alpha-selected")
    target.select_option(BETA)
    profile.select_option("beta-selected")
    target.select_option(ALPHA)
    require(profile.input_value() == "alpha-selected", "Switching startup project lost its selected launch profile")
    selected = page.evaluate("""() => ({
        profiles: Object.fromEntries(sharpforge.workbenchServices.profiles.selected),
        startup: sharpforge.getState().startupProject,
        compiler: sharpforge.workbenchServices.builds.activeId
    })""")
    require(selected["profiles"] == {ALPHA: "alpha-selected", BETA: "beta-selected"}, "Project profile selections leaked")
    require(selected["startup"] == ALPHA and selected["compiler"] == ALPHA, "Toolbar did not select the Studio project")
    page.evaluate("""projects => {
        const services = sharpforge.workbenchServices;
        services.startup.configure({mode: 'multiple', entries: projects.map((projectId, order) => ({
            projectId, order, action: 'start', profile: services.profiles.selected.get(projectId)
        }))});
    }""", PROJECTS)
    require(target.input_value() == "$multiple", "The toolbar does not reflect multiple startup projects")
    checks.append({"name": "toolbar retains the selected launch profile separately for each project", "passed": True})


def sessions(page):
    return page.evaluate("""() => sharpforge.workbenchServices.sessions.list().map(session => ({
        id: session.id, identity: session.identity, projectId: session.projectId,
        output: session.programOutput, live: session.live, state: session.state,
        uiActive: session.debug?.uiActive, renderer: session.renderer,
        channel: sharpforge.workbenchServices.output.get(session.channelId),
        resources: session.resources()
    }))""")


def expected_output(name):
    return f"{name}-output\n{name} argument 雪\n{name} environment\n"


def assert_panel(page, session, text):
    panel_id = "app:" + session["id"]
    page.evaluate("id => sharpforge.openTool(id)", panel_id)
    panel = page.locator(f'[data-app-session="{session["id"]}"]')
    panel.wait_for(state="visible")
    require(text in panel.locator(".winui-app-root").inner_text(), "The actual application panel did not render its window")
    registered = page.evaluate("""id => {
        const panel = sharpforge.applicationWindows.panels.get(id);
        return panel?.element.ownerDocument === document && panel.id === 'app:' + id &&
            JSON.stringify(sharpforge.getLayout()).includes(JSON.stringify(panel.id));
    }""", session["id"])
    require(registered, "Application panel is not owned by Studio's actual docking host")


def launch_both(page, checks):
    page.locator("#start").click()
    wait_condition(page, r"""() => {
        const services = sharpforge.workbenchServices;
        const sessions = services.sessions.list();
        return services.launches.operations.size === 0 && sessions.length === 2 &&
            sessions.every(session => session.live && session.debug?.uiActive && !session.launchBusy &&
                session.programOutput.endsWith(' environment\n'));
    }""", timeout=60000)
    by_project = {session["projectId"]: session for session in sessions(page)}
    alpha, beta = by_project[ALPHA], by_project[BETA]
    require(alpha["identity"] != beta["identity"], "Two applications share a runtime identity")
    for name, session in (("alpha", alpha), ("beta", beta)):
        require(session["output"] == expected_output(name),
                f"{name} argv, environment or output isolation failed: {session['output']!r}")
        require(session["channel"]["sessionId"] == session["id"], "Program output has another session's channel")
        require(session["channel"]["projectId"] == session["projectId"], "Program output has another project's channel")
        require(session["renderer"] == "dom", "Selected launch profile renderer was not applied")
        assert_panel(page, session, name.capitalize() + " window")
    page.evaluate("""ids => {
        const services = sharpforge.workbenchServices;
        const alpha = services.sessions.require(ids.alpha);
        const beta = services.sessions.require(ids.beta);
        window.a19Qualification = {alphaId: alpha.id, betaId: beta.id, betaIdentity: beta.identity,
            betaWorker: beta.worker.worker, betaPanel: sharpforge.applicationWindows.panels.get(beta.id)};
        if (alpha.worker.worker === beta.worker.worker) throw new Error('Applications share a runtime Worker');
        if (services.builds.get(alpha.projectId).worker.worker === services.builds.get(beta.projectId).worker.worker) {
            throw new Error('Projects share a compiler Worker');
        }
    }""", {"alpha": alpha["id"], "beta": beta["id"]})
    checks.append({"name": "Start toolbar launches two actual WinUI applications with isolated profile output",
                   "passed": True, "resources": [alpha["resources"], beta["resources"]]})
    return alpha, beta


def switch_and_stop_one(page, checks, alpha, beta):
    process = page.locator('.sf-debug-location-toolbar select[aria-label="Process"]')
    for session, name in ((beta, "beta"), (alpha, "alpha")):
        process.select_option(session["id"])
        state = page.evaluate("""() => ({id: sharpforge.workbenchServices.sessions.activeId,
            debug: sharpforge.getState().debug})""")
        require(state["id"] == session["id"] and state["debug"]["appId"] == session["id"],
                "Process selection did not route the shared Studio debugger to that application")
        require(state["debug"]["output"] == expected_output(name), "Selected process shows another application's output")
    page.locator("#stop").click()
    wait_condition(page, """() => {
        const sessions = sharpforge.workbenchServices.sessions;
        return sessions.require(a19Qualification.alphaId).state === 'stopped' &&
            sessions.activeId === a19Qualification.betaId;
    }""")
    preserved = page.evaluate("""() => {
        const services = sharpforge.workbenchServices;
        const beta = services.sessions.require(a19Qualification.betaId);
        return beta.identity === a19Qualification.betaIdentity && beta.worker.worker === a19Qualification.betaWorker &&
            beta.live && beta.debug.uiActive && sharpforge.applicationWindows.panels.get(beta.id) === a19Qualification.betaPanel &&
            services.documents.models.get('Alpha/Program.cs').readOnly === false &&
            services.documents.models.get('Beta/Program.cs').readOnly === true;
    }""")
    require(preserved, "Stopping Alpha changed Beta or left incorrect document locks")
    page.evaluate("() => sharpforge.applicationWindows.close(a19Qualification.alphaId)")
    require(page.evaluate("sharpforge.applicationWindows.panels.size") == 1, "Closing stopped Alpha removed the wrong panel")
    assert_panel(page, beta, "Beta window")
    checks.append({"name": "Process selector and Stop toolbar affect only the selected application", "passed": True})


def background_build(page, checks, beta):
    page.locator('.sf-startup-target select[aria-label="Startup target"]').select_option(BETA)
    require(page.locator('.sf-startup-target select[aria-label="Launch profile"]').input_value() == "beta-selected",
            "Selecting Beta after a multi-project launch lost its profile")
    page.evaluate("sharpforge.openFile('Beta/Program.cs')")
    result = page.evaluate("""async () => {
        const services = sharpforge.workbenchServices;
        services.documents.update('Alpha/Program.cs', 'class Broken { invalid syntax');
        const summary = await services.queue.run(['Alpha/Alpha.csproj'], {background: true});
        return {failed: summary.failed, alpha: services.diagnostics.query({projectId: 'Alpha/Alpha.csproj'}),
            beta: services.diagnostics.query({projectId: 'Beta/Beta.csproj'}),
            activeCompiler: services.builds.activeId, activeSession: services.sessions.activeId,
            startup: sharpforge.getState().startupProject, activeDocument: sharpforge.getState().active};
    }""")
    require(result["failed"] == [ALPHA] and any(item["severity"] == "error" for item in result["alpha"]),
            "A failing Alpha background build did not report project diagnostics")
    require(not result["beta"], "Alpha background diagnostics leaked to Beta")
    require(result["activeCompiler"] == BETA and result["startup"] == BETA and result["activeDocument"] == "Beta/Program.cs",
            "Background build changed Studio's selected project or document")
    require(result["activeSession"] == beta["id"], "Background build selected another runtime")
    after = next(session for session in sessions(page) if session["id"] == beta["id"])
    require(after["identity"] == beta["identity"] and after["live"] and after["uiActive"] and after["output"] == beta["output"],
            "Background compilation changed the other running application")
    checks.append({"name": "failing background project build preserves active project, application, output and diagnostics", "passed": True})


def new_instance_and_stop_all(page, checks, beta):
    result = page.evaluate("sharpforge.execute('start-new-instance')")
    require(result and len(result["started"]) == 1 and not result["failed"], "Start New Instance command did not launch the selected project")
    new_id = result["started"][0]
    page.evaluate("id => { a19Qualification.newId = id; }", new_id)
    wait_condition(page, r"""() => {
        const session = sharpforge.workbenchServices.sessions.require(a19Qualification.newId);
        return session.live && session.debug?.uiActive && !session.launchBusy &&
            session.programOutput.endsWith(' environment\n');
    }""", timeout=60000)
    current = {session["id"]: session for session in sessions(page)}
    new_session = current[new_id]
    require(new_session["projectId"] == BETA and new_session["output"] == expected_output("beta"),
            "Start New Instance ignored the selected project's profile")
    require(current[beta["id"]]["identity"] == beta["identity"] and current[beta["id"]]["live"],
            "Start New Instance replaced the existing Beta runtime")
    require(new_session["identity"] != beta["identity"] and new_session["channel"]["id"] != beta["channel"]["id"],
            "New instance reused another application's identity or output channel")
    require(page.evaluate("sharpforge.applicationWindows.panels.size") == 2, "New instance reused the existing application panel")
    assert_panel(page, new_session, "Beta window")
    page.evaluate("sharpforge.execute('stop-all')")
    wait_condition(page, """() => {
        const services = sharpforge.workbenchServices;
        return services.sessions.list({liveOnly: true}).length === 0 && services.launches.operations.size === 0 &&
            [...services.documents.models.values()].every(model => !model.readOnly) &&
            !document.querySelector('#start').disabled && document.querySelector('#stop').disabled;
    }""")
    page.evaluate("""async () => {
        for (const session of sharpforge.workbenchServices.sessions.list()) {
            await sharpforge.applicationWindows.close(session.id);
        }
        delete window.a19Qualification;
    }""")
    require(page.evaluate("sharpforge.applicationWindows.panels.size") == 0, "Stopped application panels were not disposed")
    checks.append({"name": "Start New Instance retains the selected profile and Stop All releases every application lock", "passed": True})


def run():
    checks, errors = [], []
    started = time.perf_counter()
    failure = None
    try:
        if os.getenv("SHARPFORGE_IN_MEMORY") == "1":
            raise RuntimeError("A19 multi-session qualification requires production HTTP and real worker URLs")
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.set_default_timeout(30000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            prepare_studio(page, checks)
            configure_profiles(page, checks)
            alpha, beta = launch_both(page, checks)
            switch_and_stop_one(page, checks, alpha, beta)
            background_build(page, checks, beta)
            new_instance_and_stop_all(page, checks, beta)
            require(not errors, "Uncaught browser errors: " + json.dumps(errors))
    except BaseException as error:
        failure = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        report = {"target": "production-studio-real-workers", "status": "failed" if failure else "passed",
                  "engine": selected_engine(), "checks": checks, "failure": failure, "pageErrors": errors,
                  "milliseconds": round((time.perf_counter() - started) * 1000, 2)}
        destination = results_dir() / "a19-multi-session-results.json"
        destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    run()
