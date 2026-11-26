import { readFile } from "node:fs/promises";
import { WorkspaceStore } from "./store.mjs";
import { startServer } from "./server.mjs";

const [command = "serve", ...args] = process.argv.slice(2);
const flags = Object.fromEntries(args.map((a) => { const i = a.indexOf("="); if (!a.startsWith("--") || i < 0) throw Error("Use --name=value."); return [a.slice(2, i), a.slice(i + 1)]; }));
const store = new WorkspaceStore({ id: flags.workspace ?? "default", root: flags.data ?? process.env.EAGLE_DATA_ROOT });
try {
    if (command === "serve") {
        const panel = await startServer({ store });
        console.log(`Eagle OS is ready: ${panel.url}`);
        const stop = async () => { await panel.close(); process.exit(0); };
        process.once("SIGINT", stop); process.once("SIGTERM", stop);
    } else if (command === "state") console.log(JSON.stringify(await store.read(), null, 2));
    else if (command === "apply") {
        if (!flags.file) throw Error("Supply --file with a local command JSON file.");
        const input = JSON.parse(await readFile(flags.file, "utf8"));
        const result = await store.mutate(input.command, input.payload, input.expectedRevision);
        console.log(JSON.stringify({ revision: result.revision, workspaceId: result.workspaceId }));
    } else throw Error("Command must be serve, state or apply.");
} catch (error) { console.error(`Eagle OS failed: ${error.message}`); process.exitCode = 1; }
