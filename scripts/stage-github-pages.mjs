import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceFile = resolve("dashboard/live-round1.html");
const docsDir = resolve("docs");
const targetFile = resolve("docs/index.html");
const noJekyllFile = resolve("docs/.nojekyll");

await mkdir(dirname(targetFile), { recursive: true });
await copyFile(sourceFile, targetFile);
await writeFile(noJekyllFile, "\n");

console.log(`Staged GitHub Pages site at ${targetFile}`);
