import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (s) => createHash("sha256").update(s).digest("hex");
const textExtensions = /\.(?:mjs|json|md|html|css|yml|yaml|txt)$/;
const reviewedPngPath = /^docs\/assets\/[a-z0-9-]+\.png$/;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const safePngChunks = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const allowedNames = new Set([".gitignore", ".gitattributes", "pre-commit", "LICENSE"]);
const skip = new Set([".git", "node_modules", ".test-output"]);
export function inspectPng(name, bytes, rules = {}) {
    const findings = inspectText(name, "", rules);
    if (bytes.length < 33 || pngSignature.some((byte, index) => bytes[index] !== byte)) {
        findings.push({ file: name, line: 0, category: "malformed-image-asset" });
        return findings;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, first = true, sawEnd = false;
    while (offset < bytes.length) {
        if (sawEnd || offset + 12 > bytes.length) {
            findings.push({ file: name, line: 0, category: "malformed-image-asset" });
            return findings;
        }
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (offset + 12 + length > bytes.length || (first && type !== "IHDR")) {
            findings.push({ file: name, line: 0, category: "malformed-image-asset" });
            return findings;
        }
        if (!safePngChunks.has(type)) findings.push({ file: name, line: 0, category: "unreviewed-image-metadata" });
        first = false;
        if (type === "IEND") sawEnd = true;
        offset += 12 + length;
    }
    if (!sawEnd) findings.push({ file: name, line: 0, category: "malformed-image-asset" });
    return findings;
}
export function inspectText(name, content, rules = {}) {
    const findings = [];
    const patterns = [
        ["credential", /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,})/g],
        ["personal-path", /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"']+|\/(?:home|Users)\/[a-z][^/\s"']+/g],
        ["filled-email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
        ["opaque-id", /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|19:[^\s"'<>]+@thread\.\w+/gi],
        ["runtime-state", /(?:board|profile|source-coverage)\.json$/],
    ];
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
        for (const [category, pattern] of patterns) {
            pattern.lastIndex = 0;
            if (pattern.test(category === "runtime-state" ? name : line)) findings.push({ file: name, line: lineIndex + 1, category });
        }
        const combined = `${name}\n${line}`.normalize("NFKC").toLowerCase();
        for (const term of rules.forbiddenTerms ?? []) {
            if (typeof term !== "string" || term.length < 3) throw Error("Private forbidden terms must be explicit strings of at least three characters.");
            if (combined.includes(term.normalize("NFKC").toLowerCase())) findings.push({ file: name, line: lineIndex + 1, category: "private-identifier" });
        }
        for (const match of line.matchAll(/https?:\/\/[^\s"'`<>]+/g)) {
            let url;
            try { url = new URL(match[0].replace(/[),;.]$/, "")); } catch { findings.push({ file: name, line: lineIndex + 1, category: "unclassified-url" }); continue; }
            const allowed = ["example.test", "registry.npmjs.org", "127.0.0.1", "localhost"];
            if (!allowed.includes(url.hostname) || url.username || url.password) findings.push({ file: name, line: lineIndex + 1, category: "unreviewed-host" });
        }
    }
    return findings;
}
async function files(directory) {
    const list = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw Error("Symlinks cannot enter a release tree.");
        if (entry.isDirectory()) list.push(...await files(path)); else list.push(path);
    }
    return list;
}
export async function scanTree(directory = root, rules = {}) {
    const findings = [], manifest = [];
    for (const file of await files(directory)) {
        const name = relative(directory, file).replaceAll("\\", "/");
        const data = await readFile(file);
        if (reviewedPngPath.test(name)) {
            findings.push(...inspectPng(name, data, rules));
            manifest.push({ file: name, sha256: digest(data), bytes: data.length });
            continue;
        }
        if (!textExtensions.test(name) && !allowedNames.has(name.split("/").at(-1))) {
            findings.push({ file: name, line: 0, category: "unreviewed-file-type" }); continue;
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
        findings.push(...inspectText(name, content, rules));
        manifest.push({ file: name, sha256: digest(data), bytes: data.length });
    }
    return { files: manifest.length, findings, manifest };
}
export function scanHistory(directory = root, rules = {}) {
    const revisions = execFileSync("git", ["rev-list", "--all"], { cwd: directory, encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
    const findings = [], seen = new Set();
    for (const revision of revisions) {
        const entries = execFileSync("git", ["ls-tree", "-r", revision], { cwd: directory, encoding: "utf8" }).trim().split("\n").filter(Boolean);
        for (const entry of entries) {
            const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
            if (!match) throw Error("Unsupported Git object in history.");
            const [, mode, object, name] = match;
            const isReviewedPng = reviewedPngPath.test(name);
            if (mode === "120000" || (!isReviewedPng && !textExtensions.test(name) && !allowedNames.has(name.split("/").at(-1)))) {
                findings.push({ file: name, line: 0, category: "unreviewed-history-type" }); continue;
            }
            if (seen.has(`${object}:${name}`)) continue;
            seen.add(`${object}:${name}`);
            const bytes = execFileSync("git", ["cat-file", "blob", object], { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
            if (isReviewedPng) {
                findings.push(...inspectPng(name, bytes, rules));
                continue;
            }
            const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            findings.push(...inspectText(name, content, rules));
        }
    }
    return { revisions: revisions.length, objects: seen.size, findings };
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    try {
        const args = process.argv.slice(2), privatePath = args.find((a) => a.startsWith("--rules="))?.slice(8) ?? process.env.EAGLE_PRIVATE_RULES;
        if (args.includes("--release") && !privatePath) throw Error("Release verification requires an external private rule pack; baseline scanning is not a full publication clearance.");
        if (privatePath && !relative(root, resolve(privatePath)).startsWith("..")) throw Error("Private rule pack must remain outside the repository.");
        const rules = privatePath ? JSON.parse(await readFile(privatePath, "utf8")) : {};
        const tree = await scanTree(root, rules);
        const history = args.includes("--history") ? scanHistory(root, rules) : { revisions: 0, findings: [] };
        const findings = [...tree.findings, ...history.findings];
        console.log(JSON.stringify({ files: tree.files, privateRulesApplied: !!privatePath, historyRevisions: history.revisions,
            findings, manifest: tree.manifest }, null, 2));
        if (findings.length) process.exitCode = 1;
    } catch (error) { console.error(`Sanitization failed: ${error.message}`); process.exitCode = 1; }
}
