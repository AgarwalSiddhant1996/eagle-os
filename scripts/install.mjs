import { mkdir, readFile, readdir, cp, rename, rm, lstat, writeFile, realpath } from "node:fs/promises";
import { dirname, basename, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { scanTree } from "./sanitize.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const within = (a, b) => { const rel = relative(a, b); return !rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
const exists = async (p) => { try { return await lstat(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
async function rejectLinks(root) {
    const info = await exists(root); if (!info) return;
    if (info.isSymbolicLink()) throw Error("Installer does not follow symlinks.");
    if (info.isDirectory()) for (const child of await readdir(root)) await rejectLinks(join(root, child));
}
export async function install({ source = sourceRoot, target, dataRoot }) {
    if (!target || !dataRoot) throw Error("Specify an explicit code target and external data root.");
    target = resolve(target); dataRoot = resolve(dataRoot); source = await realpath(source);
    if (within(target, dataRoot) || within(dataRoot, target) || within(source, target) || within(target, source)) throw Error("Code, source checkout and user-data paths must not overlap.");
    await mkdir(dirname(target), { recursive: true });
    for (const name of ["src", "ui", "skills", "extension.mjs", "package.json", "LICENSE"]) await rejectLinks(join(source, name));
    await rejectLinks(target);
    target = join(await realpath(dirname(target)), basename(target));
    const dataParent = await exists(dataRoot) ? await realpath(dataRoot) : join(await realpath(dirname(dataRoot)), basename(dataRoot));
    if (within(target, dataParent) || within(dataParent, target) || within(source, target) || within(target, source)) throw Error("Canonical code and user-data paths must not overlap.");
    const checked = await scanTree(source);
    if (checked.findings.length) throw Error("Source tree failed baseline sanitization; run check for details.");
    const previous = await exists(target);
    if (previous) {
        const marker = JSON.parse(await readFile(join(target, "eagle-install.json"), "utf8"));
        if (marker.application !== "eagle-os") throw Error("Target is not a recognized code-only installation.");
        if (marker.schemaVersion !== 1) throw Error("Installed data compatibility requires a separate migration review.");
        if ((await readdir(target)).some((n) => !["src", "ui", "skills", "extension.mjs", "package.json", "LICENSE", "eagle-install.json"].includes(n))) throw Error("Refusing to replace a target containing unknown files or user state.");
    }
    const suffix = randomUUID(), staging = `${target}.${suffix}.pending`, backup = previous ? `${target}.${suffix}.backup` : "";
    try {
        await mkdir(staging);
        for (const name of ["src", "ui", "skills", "extension.mjs", "package.json", "LICENSE"]) await cp(join(source, name), join(staging, name), { recursive: true, errorOnExist: true });
        const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
        await writeFile(join(staging, "eagle-install.json"), JSON.stringify({ application: "eagle-os", version: pkg.version, schemaVersion: 1, installedAt: new Date().toISOString() }, null, 2));
        if (backup) await rename(target, backup);
        try { await rename(staging, target); }
        catch (error) { if (backup) await rename(backup, target); throw error; }
        return { target, backup, dataRoot, version: pkg.version, reloadRequired: true };
    } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf("="); return [a.slice(2, i), a.slice(i + 1)]; }));
    install({ target: args.target, dataRoot: args.data }).then((result) => console.log(JSON.stringify(result)))
        .catch((e) => { console.error(`Install failed: ${e.message}`); process.exitCode = 1; });
}
