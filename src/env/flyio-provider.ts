import { execSync } from "node:child_process";
import chalk from "chalk";
import type { EnvProvider } from "./env-provider.js";

function extractValue(output: string): string | null {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.match(/^(Connecting|Warning|Error|info:)/i));
  return lines.length > 0 ? (lines[0] ?? null) : null;
}

function isSensitive(key: string): boolean {
  return ["PASSWORD", "SECRET", "KEY", "TOKEN"].some((term) => key.toUpperCase().includes(term));
}

export class FlyioEnvProvider implements EnvProvider {
  readonly name = "flyio";
  private readonly app: string;

  constructor(app: string) {
    this.app = app;
  }

  async fetch(secrets: string[]): Promise<Record<string, string>> {
    console.log(chalk.cyan(`Fetching secrets from Fly.io app '${this.app}'...`));
    console.log("");

    const entries = secrets.map((secret) => {
      process.stdout.write(`  Fetching ${secret}... `);
      const value = this.fetchSecret(secret);

      if (value) {
        const display = isSensitive(secret) ? `${value.slice(0, 6)}...` : value;
        console.log(chalk.green(display));
        return [secret, value] as const;
      }

      console.log(chalk.yellow("skipped"));
      return null;
    });

    const result = Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));

    const failures = secrets.filter((s) => !(s in result));

    console.log("");

    if (failures.length > 0) {
      console.log(chalk.yellow(`Skipped (not set on server): ${failures.join(", ")}`));
    }

    return result;
  }

  private fetchSecret(envVar: string): string | null {
    try {
      const output = execSync(`fly ssh console -a ${this.app} -C "printenv ${envVar}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return extractValue(output);
    } catch (err: unknown) {
      const stdout = (err as { stdout?: string }).stdout || "";
      if (stdout) {
        return extractValue(stdout);
      }
      return null;
    }
  }
}
