import { cp, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const publicEntries = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js",
  "robots.txt",
  "sitemap.xml",
  ".nojekyll",
  "assets/app-icon.svg",
  "assets/matchup_matrix.svg",
  "assets/matchup_matrix_elite.svg",
  "assets/og-card.png",
  "assets/og-card.svg",
  "assets/site-data.js",
  "data/aggregates.json",
  "data/manifest.json",
  "data/matchups.json",
  "data/prices.json",
];

async function assertNoSymlinks(source, label = source) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`public artifact cannot be a symlink: ${path.relative(root, source)}`);
  if (!info.isDirectory()) return;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const child = path.join(source, entry.name);
    const childInfo = await lstat(child);
    if (childInfo.isSymbolicLink()) throw new Error(`public artifact cannot contain symlink: ${path.relative(root, child)}`);
    if (childInfo.isDirectory()) await assertNoSymlinks(child, label);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of publicEntries) {
  const source = path.join(root, entry);
  const target = path.join(dist, entry);
  await assertNoSymlinks(source);
  await cp(source, target, { recursive: true, force: true, errorOnExist: false });
}

console.log(`built clean Pages artifact: ${path.relative(root, dist)}/ (${publicEntries.length} allowlisted entries)`);
