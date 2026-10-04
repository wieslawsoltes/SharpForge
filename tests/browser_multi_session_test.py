"""A19: independent projects and real compiler/runtime workers in a served browser."""
import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir


def check(value, message):
    if not value:
        raise AssertionError(message)


if os.getenv("SHARPFORGE_IN_MEMORY") == "1":
    raise RuntimeError("A19 multi-session qualification requires the HTTP browser harness for real worker URLs")

source = """
using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program {
    static void Main() {
        var window = new Window();
        window.Title = "APP_NAME";
        var text = new TextBlock();
        text.Text = "APP_TEXT";
        window.Content = text;
        window.Activate();
        Console.WriteLine("APP_OUTPUT");
    }
}
"""
checks = []
started = time.perf_counter()
with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    load_application(page)
    sources = {
        "Alpha.cs": source.replace("APP_NAME", "Alpha").replace("APP_TEXT", "Alpha window").replace("APP_OUTPUT", "alpha-output"),
        "Beta.cs": source.replace("APP_NAME", "Beta").replace("APP_TEXT", "Beta window").replace("APP_OUTPUT", "beta-output"),
    }
    page.evaluate("""async sources => {
        const {createWorkbenchServices} = await import('./workbench/sessions.js');
        const {ApplicationWindows} = await import('./workbench/application-window.js');
        const root = document.createElement('section');
        root.id = 'multi-session-qualification';
        root.style.cssText = 'position:fixed;inset:80px;display:flex;background:#222;z-index:9000;gap:10px';
        document.body.append(root);
        const records = Object.entries(sources).map(([uri,text]) => ({uri,text,version:1}));
        const services = createWorkbenchServices({records, projects: records.map(record => ({
            id: record.uri, name: record.uri, outputType: 'exe', files: [record]
        }))});
        const windows = new ApplicationWindows({sessions:services.sessions, document,
            registerPanel(panel) {panel.element.style.cssText='flex:1;min-width:0';root.append(panel.element);return ()=>panel.element.remove();},
            confirmStop:async()=>true, onError:error=>{throw error;}
        });
        services.startup.configure({mode:'multiple',entries:records.map(record=>({projectId:record.uri}))});
        window.p16Qualification = {services,windows,root};
        const launched = await services.launches.start({debug:false});
        if(launched.failed.length) throw new Error(launched.failed.map(value=>value.error.message).join('\n'));
    }""", sources)
    wait_condition(page, """() => {
        const sessions=p16Qualification.services.sessions.list();
        return sessions.length===2 && sessions.every(session=>session.debug?.uiActive);
    }""", timeout=30000)
    wait_condition(page, "document.querySelector('#multi-session-qualification').textContent.includes('Alpha window')")
    wait_condition(page, "document.querySelector('#multi-session-qualification').textContent.includes('Beta window')")
    state = page.evaluate("""() => p16Qualification.services.sessions.list().map(session=>({
        id:session.id,identity:session.identity,output:session.programOutput,projectId:session.projectId,state:session.state
    }))""")
    check("alpha-output" in state[0]["output"] and "beta-output" not in state[0]["output"], "Alpha output isolation failed")
    check("beta-output" in state[1]["output"] and "alpha-output" not in state[1]["output"], "Beta output isolation failed")
    checks.append({"name": "two real compiler/runtime workers and independent WinUI panels", "passed": True})
    page.evaluate("""async () => {
        const {services,windows}=p16Qualification;
        const [first,second]=services.sessions.list();
        window.p16OtherIdentity=second.identity;
        await windows.close(first.id);
    }""")
    check(page.evaluate("p16Qualification.services.sessions.list()[1].identity===p16OtherIdentity"), "Stopping Alpha changed Beta identity")
    check(page.evaluate("p16Qualification.services.sessions.list()[1].debug.uiActive"), "Stopping Alpha stopped Beta")
    check(page.locator("#multi-session-qualification [data-app-session]").count() == 1, "Closing one app removed another panel")
    checks.append({"name": "closing one application stops only its worker session", "passed": True})
    page.evaluate("""async () => {
        const {services}=p16Qualification;
        services.documents.update('Alpha.cs','class Broken { invalid syntax');
        await services.builds.get('Alpha.cs').build();
    }""")
    check(page.evaluate("p16Qualification.services.diagnostics.query({projectId:'Alpha.cs'}).length>0"), "Expected Alpha diagnostics")
    check(page.evaluate("p16Qualification.services.diagnostics.query({projectId:'Beta.cs'}).length===0"), "Alpha diagnostics leaked to Beta")
    check(page.evaluate("p16Qualification.services.sessions.list()[1].identity===p16OtherIdentity"), "Background build changed Beta")
    checks.append({"name": "project diagnostics and background build isolation", "passed": True})
    page.evaluate("p16Qualification.windows.dispose();p16Qualification.services.dispose();p16Qualification.root.remove()")
    check(not errors, json.dumps(errors))

report = {"target": "browser-real-workers", "checks": checks, "milliseconds": round((time.perf_counter()-started)*1000, 2)}
destination = results_dir() / "a19-multi-session-results.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
