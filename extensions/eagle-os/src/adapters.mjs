import { realpath, readFile } from "node:fs/promises";
import { relative, sep, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { InputError, text } from "./store.mjs";

export async function listAdapters(dataRoot) {
    try {
        const list = JSON.parse(await readFile(join(dataRoot, "adapters.json"), "utf8"));
        if (!Array.isArray(list)) throw new InputError("Local adapters.json must be an array.");
        return list.map((a) => ({ id: text(a.id, "Adapter id", 60), label: text(a.label, "Adapter label", 80),
            module: text(a.module, "Local adapter module", 4096), capabilities: a.capabilities }));
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
export async function readAdapter({ adapter, dataRoot, approved = false, window }) {
    if (approved !== true) throw new InputError("Explicit local adapter execution approval is required.");
    if (!adapter.capabilities?.includes("read")) throw new InputError("Adapter does not declare read capability.");
    const root = await realpath(join(dataRoot, "connectors")), target = await realpath(adapter.module);
    const rel = relative(root, target);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new InputError("Adapter code must stay in the local connectors directory.");
    const plugin = await import(pathToFileURL(target).href);
    if (plugin.apiVersion !== 1 || typeof plugin.read !== "function") throw new InputError("Adapter must implement API version 1 and read().");
    const result = await plugin.read({ window });
    if (!result || !Array.isArray(result.records) || !["complete", "partial", "blocked"].includes(result.status)) throw new InputError("Adapter returned no honest source status.");
    if (result.status === "complete" && (result.nextCursor || result.terminal !== true)) throw new InputError("A nonterminal adapter cannot report complete.");
    return result;
}
