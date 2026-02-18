#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const hashFile = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

const hashDeps = (): string => {
  const lock = join(projectRoot, "package-lock.json");
  return existsSync(lock) ? hashFile(lock) : "";
};

const findTsFiles = (dir: string, acc: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findTsFiles(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc.sort();
};

const hashSrc = (): string => {
  const h = createHash("sha256");
  for (const f of findTsFiles(join(projectRoot, "src"))) h.update(hashFile(f));
  return h.digest("hex");
};

const stored = (p: string): string => {
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
};

const depsHashFile = join(projectRoot, "node_modules", ".install-hash");
if (!existsSync(join(projectRoot, "node_modules")) || stored(depsHashFile) !== hashDeps()) {
  console.error("Installing dependencies...");
  execSync("npm install --silent", { cwd: projectRoot, stdio: "inherit" });
  writeFileSync(depsHashFile, hashDeps());
}

const buildHashFile = join(projectRoot, "dist", ".build-hash");
const srcHash = hashSrc();
if (!existsSync(join(projectRoot, "dist", "index.js")) || stored(buildHashFile) !== srcHash) {
  console.error("Building...");
  execSync("npm run build --silent", { cwd: projectRoot, stdio: "inherit" });
  writeFileSync(buildHashFile, srcHash);
}

await import(pathToFileURL(join(projectRoot, "dist", "index.js")).href);
