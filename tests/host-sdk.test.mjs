import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNativeBridge } from "../src/host-native.mjs";

test("native adapter uses supported session.sessionId and bound session.send({prompt,displayPrompt}) only", async () => {
    let active;
    const bridge = createNativeBridge(() => active, "panel-one");
    assert.equal(bridge.sessionId, "");
    await assert.rejects(() => bridge.send({ prompt: "Scoped request", displayPrompt: "Visible request" }), /disconnected/);
    const sends = [];
    active = { sessionId: "session-one", async send(value) { assert.equal(this, active); sends.push(value); return "message-one"; } };
    assert.equal(bridge.sessionId, "session-one");
    assert.equal(await bridge.send({ prompt: "Scoped request", displayPrompt: "Visible request", unsupported: true }), "message-one");
    assert.deepEqual(sends, [{ prompt: "Scoped request", displayPrompt: "Visible request" }]);
    active = undefined;
    assert.equal(bridge.sessionId, "");
    await assert.rejects(() => bridge.send({ prompt: "Do not send" }), /disconnected/);
});
test("extension joins SDK, dispatches HTTP requests, and a persisted same-session collector can reopen its native panel", async (t) => {
    const fixtures = resolve(".test-output");
    await mkdir(fixtures, { recursive: true });
    const root = await mkdtemp(join(fixtures, "host-sdk-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const sdk = join(root, "sdk.mjs"), proof = join(root, "proof.json"), data = join(root, "data");
    const installation = join(root, "installation");
    await mkdir(installation);
    for (const name of ["extension.mjs", "src", "skills"]) await cp(new URL(`../${name}`, import.meta.url), join(installation, name), { recursive: true });
    const program = `
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export let canvas;
export const messages = [];
export function createCanvas(value) { canvas = value; return value; }
const session = {sessionId:"native-session",async send(message) {
 const persisted=JSON.parse(await readFile(join(process.env.EAGLE_DATA_ROOT,"workspaces","sample","board.json"),"utf8"));
 assert.equal(persisted.host.requests.at(-1).status,"queued");
 messages.push(message); return "accepted-message";
}};
export async function joinSession(config) {
 assert.ok(config.skillDirectories[0].endsWith("skills"));
 setTimeout(()=>run().catch(error=>{console.error(error);process.exitCode=1;}),0);
 return session;
}
async function run() {
 let context={instanceId:"scheduled-panel",input:{workspace:"sample"}};
 let opened=await canvas.open(context),base=new URL(opened.url);
 let headers={"X-Workspace-Token":base.pathname.split("/")[1],"Content-Type":"application/json",Origin:base.origin};
 const post=async(path,body)=>{const response=await fetch(new URL(path,base),{method:"POST",headers,body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const state=async()=>{const r=await fetch(new URL("state",base),{headers});return r.json();};
 const action=(name,input)=>canvas.actions.find(a=>a.name===name).handler({instanceId:context.instanceId,input});
 const receipt=(identity="sample/repo")=>({identity,readback:"Read exact test metadata.",readAt:new Date().toISOString(),method:"Deterministic SDK contract adapter"});
 const coverage={complete:true,detail:"All scoped test metadata read."};
 await post("command",{command:"intake",payload:{title:"Sample workspace",preset:"feature-pm",jobs:["Review changes"],decisions:["Choose next step"],sources:[]},expectedRevision:0});
 const scope={purpose:"Review updates",sources:["repository"],repository:"sample/repo"};
 let s=await state();
 await post("host-request",{id:"initial-read",kind:"setup",scope,consent:true,expectedRevision:s.board.revision});
 assert.equal(messages.length,1);assert.deepEqual(Object.keys(messages[0]).sort(),["displayPrompt","prompt"]);
 const callback=(requestId,sequence,status,result={})=>action("record_host_result",{workspace:"sample",requestId,ownerSessionId:"native-session",sequence,status,detail:"Test readback",result});
 await callback("initial-read",1,"running");
 await callback("initial-read",2,"verified",{sources:[{id:"repo",type:"repository",label:"Repository",repo:"sample/repo",status:"verified",detail:"Read actual scoped record",coverage,receipt:receipt()}],
 work:[{sourceId:"repo",externalKey:"setup-read",title:"Review actual initial source record"}],
 evidence:[{sourceId:"repo",externalKey:"setup-evidence",workExternalKey:"setup-read",summary:"Actually read initial source record.",receipt:receipt()}]});
 s=await state();
 await post("host-request",{id:"schedule-read",kind:"schedule",scope:{...scope,cadence:"daily 09:00"},consent:true,expectedRevision:s.board.revision});
 assert.match(messages[1].prompt,/first call supported open_canvas/);
 assert.match(messages[1].prompt,/No save_workflow/);
 await callback("schedule-read",1,"running");
 const automation={id:"saved-schedule",name:"Sample collector",cadence:"daily 09:00",status:"enabled",lastRunAt:null,nextRunAt:new Date(Date.now()+86400000).toISOString(),coverage,receipt:receipt("saved-schedule"),sessionId:"native-session",provider:"session-automation"};
 await callback("schedule-read",2,"verified",{automation});
 await canvas.onClose({instanceId:context.instanceId});
 opened=await canvas.open(context);base=new URL(opened.url);headers={"X-Workspace-Token":base.pathname.split("/")[1],"Content-Type":"application/json",Origin:base.origin};
 s=await state();assert.equal(s.host.automation.id,"saved-schedule");assert.equal(s.host.sessionId,"native-session");
 const wake=await action("request_collection",{workspace:"sample",id:"fresh-wake",scope});
 assert.equal(wake.request.status,"queued");assert.equal(wake.request.scheduleId,"saved-schedule");assert.equal(messages.length,2);
 await callback("fresh-wake",1,"running");
 await callback("fresh-wake",2,"verified",{sources:[{id:"repo",type:"repository",label:"Repository",repo:"sample/repo",status:"verified",detail:"Incremental read",coverage,receipt:receipt()}],
 work:[{sourceId:"repo",externalKey:"new-change",title:"New scoped change"}],
 evidence:[{sourceId:"repo",externalKey:"new-evidence",workExternalKey:"new-change",summary:"Actual deterministic adapter read.",receipt:receipt()}],
 automation:{...automation,lastRunAt:new Date().toISOString(),receipt:receipt("saved-schedule")}});
 s=await state();assert.equal(s.board.work.length,2);assert.equal(s.host.requests.at(-1).status,"verified");assert.ok(s.host.automation.lastRunAt);
 const replay=await action("request_collection",{workspace:"sample",id:"fresh-wake",scope});
 assert.equal(replay.request.status,"verified");assert.match(replay.prompt,/already terminal/);
 assert.equal(s.host.requests.find(r=>r.id==="schedule-read").sequence,2);
 await canvas.onClose({instanceId:context.instanceId});
 await writeFile(process.env.EAGLE_TEST_PROOF,JSON.stringify({sent:messages.length,work:s.board.work.length,schedule:s.host.automation.id}));
}
`;
    await writeFile(sdk, program);
    await promisify(execFile)(process.execPath, [join(installation, "extension.mjs")], {
        timeout: 15000, env: { ...process.env, EAGLE_HOST_SDK: pathToFileURL(sdk).href, EAGLE_DATA_ROOT: data, EAGLE_TEST_PROOF: proof },
    });
    assert.deepEqual(JSON.parse(await readFile(proof, "utf8")), { sent: 2, work: 2, schedule: "saved-schedule" });
});
test("opt-in native startup diagnostics locate a pending SDK join without leaking config or changing the handshake", async (t) => {
    const fixtures = resolve(".test-output");
    await mkdir(fixtures, { recursive: true });
    const root = await mkdtemp(join(fixtures, "startup-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const installation = join(root, "installation"), sdk = join(root, "sdk.mjs");
    await mkdir(installation);
    for (const name of ["extension.mjs", "src"]) await cp(new URL(`../${name}`, import.meta.url), join(installation, name), { recursive: true });
    const env = { ...process.env, EAGLE_HOST_SDK: pathToFileURL(sdk).href, EAGLE_DATA_ROOT: join(root, "private-config-marker"),
        EAGLE_WORKSPACE: "sample", EAGLE_STARTUP_DIAGNOSTICS: "1" };
    const command = [join(installation, "extension.mjs")];
    await writeFile(sdk, `
export function createCanvas(config) { return config; }
export async function joinSession(config) {
 if(config.canvases.length!==1 || config.skillDirectories.length!==1) throw Error("Invalid declared config");
 return {sessionId:"private-session-marker",send:async()=>{}};
}`);
    const success = await promisify(execFile)(process.execPath, command, { timeout: 5000, env });
    assert.equal(success.stdout, "", "diagnostics must not pollute the JSON-RPC stdout transport");
    const observations = success.stderr.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(observations.map((line) => line.stage), ["local-modules-loaded", "sdk-import-started", "sdk-import-completed",
        "canvas-declaration-started", "canvas-declaration-completed", "join-session-started", "join-session-completed"]);
    for (const line of observations) {
        assert.deepEqual(Object.keys(line).sort(), ["component", "elapsedMs", "stage"]);
        assert.equal(line.component, "eagle-os-startup"); assert.ok(Number.isInteger(line.elapsedMs) && line.elapsedMs >= 0);
    }
    assert.ok(!success.stderr.includes("private-config-marker") && !success.stderr.includes("private-session-marker"));
    const quiet = await promisify(execFile)(process.execPath, command, { timeout: 5000, env: { ...env, EAGLE_STARTUP_DIAGNOSTICS: "" } });
    assert.equal(quiet.stdout, ""); assert.equal(quiet.stderr, "");
    await writeFile(sdk, `
export function createCanvas(config) { return config; }
export async function joinSession() {
 setInterval(()=>{},10000);
 return new Promise(()=>{});
}`);
    await assert.rejects(() => promisify(execFile)(process.execPath, command, { timeout: 6500, env }), (error) => {
        assert.equal(error.killed, true);
        assert.equal(error.stdout, "");
        const stages = error.stderr.trim().split("\n").map((line) => JSON.parse(line).stage);
        assert.equal(stages.at(-1), "join-session-pending");
        assert.ok(!stages.includes("join-session-completed") && !stages.includes("join-session-failed"), "a diagnostic timer is not a handshake timeout or success");
        return true;
    });
});
