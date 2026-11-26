import { readdir, readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)), target = join(root, "extensions", "eagle-os");
const roots = ["src", "ui", "skills", "extension.mjs", "package.json", "LICENSE"];
async function list(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw Error("Extension package inputs cannot be symlinks.");
    if (info.isFile()) return [path];
    return (await Promise.all((await readdir(path)).map((n) => list(join(path, n))))).flat();
}
export async function packageExtension(check = false) {
    const sources = (await Promise.all(roots.map((n) => list(join(root, n))))).flat();
    const expected = new Set(sources.map((p) => relative(root, p)));
    if (check) {
        const existing = await list(target);
        if (existing.length !== expected.size || existing.some((p) => !expected.has(relative(target, p)))) throw Error("Generated extension has missing or extra files. Rebuild the package.");
    }
    for (const source of sources) {
        const dest = join(target, relative(root, source)), bytes = await readFile(source);
        if (check) {
            if (!bytes.equals(await readFile(dest))) throw Error(`Generated extension is stale: ${relative(root, source)}`);
        } else {
            await mkdir(resolve(dest, ".."), { recursive: true });
            await writeFile(dest, bytes);
        }
    }
    return { directory: "extensions/eagle-os", files: sources.length, checked: check };
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    packageExtension(process.argv.includes("--check")).then((r) => console.log(JSON.stringify(r)))
        .catch((e) => { console.error(`Extension package failed: ${e.message}`); process.exitCode = 1; });
}
