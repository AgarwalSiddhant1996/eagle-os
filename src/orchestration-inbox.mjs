// Installed immutably into the external workspace callbacks directory.
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function safePayload(value, depth = 0) {
    if (depth > 20) throw Error("Callback nesting exceeds bound.");
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
        if (/^(?:.*token|password|secret|clientsecret|apikey|privatekey|authorization|cookie|credentials)$/i.test(key.replace(/[_-]/g, ""))) throw Error("Callback cannot store credentials.");
        if (typeof item === "string" && /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,})/.test(item)) throw Error("Callback cannot store credentials.");
        safePayload(item, depth + 1);
    }
}
export async function submitOwnerInbox(grantPath, result) {
    safePayload(result);
    const helperDirectory = await realpath(dirname(fileURLToPath(import.meta.url)));
    const grantActual = await realpath(resolve(grantPath));
    if (dirname(grantActual) !== helperDirectory || !/^[0-9a-f-]{36}\.json$/.test(grantActual.slice(helperDirectory.length + 1))) throw Error("Grant must belong to this installed callback helper.");
    const grant = JSON.parse(await readFile(grantActual, "utf8"));
    if (!/^[0-9a-f-]{36}$/.test(grant.assignmentId) || typeof grant.callbackCapability !== "string" || !/^[0-9a-f]{64}$/.test(grant.callbackCapability) ||
        result.workspace !== grant.workspace || result.jobId !== grant.jobId || result.assignmentId !== grant.assignmentId) throw Error("Callback grant/result binding differs.");
    const inbox = join(helperDirectory, "inbox");
    if (resolve(grant.inbox) !== inbox) throw Error("Grant inbox differs.");
    await mkdir(inbox, { recursive: true, mode: 0o700 });
    if (!(await realpath(inbox)).startsWith(helperDirectory + sep)) throw Error("Inbox redirects outside callback directory.");
    const envelope = JSON.stringify({ callbackCapability: grant.callbackCapability, result });
    if (Buffer.byteLength(envelope) > 32000) throw Error("Callback must be at most 32000 bytes.");
    const output = join(inbox, `${grant.assignmentId}.json`);
    try { await writeFile(output, envelope, { flag: "wx", mode: 0o400 }); }
    catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (await readFile(output, "utf8") !== envelope) throw Error("Immutable callback already exists with different content.");
    }
    return { submitted: true, assignmentId: grant.assignmentId };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 4 || process.argv[2] !== "--grant") throw Error("Use node owner-inbox.mjs --grant <assignment.json>; pipe bounded result JSON to stdin.");
        const chunks = []; let size = 0;
        for await (const chunk of process.stdin) {
            size += chunk.length;
            if (size > 32000) throw Error("Callback input too large.");
            chunks.push(chunk);
        }
        await submitOwnerInbox(process.argv[3], JSON.parse(Buffer.concat(chunks).toString("utf8")));
        process.stdout.write("Owner result submitted to local inbox.\n");
    } catch {
        process.stderr.write("Owner result rejected; verify bounded payload and exact local assignment grant. No result or capability logged.\n");
        process.exitCode = 1;
    }
}
