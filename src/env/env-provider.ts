import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface EnvProvider {
  name: string;
  fetch(secrets: string[]): Promise<Record<string, string>>;
}

export function parseEnvFile(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const eqIndex = line.indexOf("=");
        return eqIndex > 0 ? [line.slice(0, eqIndex), line.slice(eqIndex + 1)] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null),
  );
}

export function writeEnvFile(
  values: Record<string, string>,
  metadata: { name: string; source: string },
): string {
  const header = [
    `# Profile: ${metadata.name}`,
    `# Source: ${metadata.source}`,
    "# WARNING: This may connect to a LIVE environment. Be careful!",
    `# Generated: ${new Date().toISOString()}`,
    "",
  ];

  const body = Object.entries(values).map(([key, val]) => `${key}=${val}`);

  return [...header, ...body, ""].join("\n");
}

export function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  return parseEnvFile(readFileSync(filePath, "utf-8"));
}

export function saveEnvFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}
