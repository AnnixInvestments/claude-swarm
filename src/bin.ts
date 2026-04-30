#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

const srcDir = join(projectRoot, "src");
if (existsSync(srcDir)) {
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
}

const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code";
const updateCacheFile = join(homedir(), ".claude", "swarm-update-check");
const oneDaySeconds = 86400;

const versionRegex = /(\d+)\.(\d+)\.(\d+)/;

const localClaudeVersion = (): string | null => {
  try {
    const out = execSync("claude --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(versionRegex);
    return match ? match[0] : null;
  } catch {
    return null;
  }
};

const remoteClaudeVersion = (): string | null => {
  try {
    const out = execSync(`npm view ${CLAUDE_CODE_PACKAGE} version`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
};

const writeUpdateStamp = (): void => {
  try {
    mkdirSync(dirname(updateCacheFile), { recursive: true });
    writeFileSync(updateCacheFile, String(Math.floor(Date.now() / 1000)));
  } catch {}
};

const cacheIsFresh = (): boolean => {
  if (!existsSync(updateCacheFile)) return false;
  const last = Number(stored(updateCacheFile));
  if (!Number.isFinite(last) || last <= 0) return false;
  return Math.floor(Date.now() / 1000) - last < oneDaySeconds;
};

const minorOf = (v: string): string => v.split(".").slice(0, 2).join(".");

const checkClaudeCodeUpdate = (force: boolean): void => {
  if (process.env.CLAUDE_SWARM_NO_UPDATE_CHECK === "1") return;
  if (!force && cacheIsFresh()) return;

  const local = localClaudeVersion();
  const remote = remoteClaudeVersion();
  if (!local || !remote) return;

  if (local === remote) {
    writeUpdateStamp();
    return;
  }

  if (minorOf(local) === minorOf(remote)) {
    console.error(`Auto-updating Claude Code (patch): ${local} -> ${remote}`);
    try {
      execSync(`npm i -g ${CLAUDE_CODE_PACKAGE}`, { stdio: "ignore" });
      writeUpdateStamp();
    } catch {}
    return;
  }

  console.error("");
  console.error(`Claude Code update available: ${local} -> ${remote} (minor/major)`);
  console.error(`  npm i -g ${CLAUDE_CODE_PACKAGE}`);
  console.error("");
};

checkClaudeCodeUpdate(process.argv.includes("--check-updates"));

await import(pathToFileURL(join(projectRoot, "dist", "index.js")).href);
