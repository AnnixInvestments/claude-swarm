import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";

const ERROR_LOG_FILE = join(tmpdir(), "claude-swarm-error.log");

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export const log = {
  debug: (message: string) => {
    if (LOG_LEVELS[LOG_LEVEL as keyof typeof LOG_LEVELS] <= LOG_LEVELS.debug) {
      console.log(chalk.dim(message));
    }
  },
  info: (message: string) => {
    if (LOG_LEVELS[LOG_LEVEL as keyof typeof LOG_LEVELS] <= LOG_LEVELS.info) {
      console.log(chalk.green(message));
    }
  },
  warn: (message: string) => {
    if (LOG_LEVELS[LOG_LEVEL as keyof typeof LOG_LEVELS] <= LOG_LEVELS.warn) {
      console.log(chalk.yellow(message));
    }
  },
  error: (message: string) => {
    console.error(chalk.red(message));
    try {
      appendFileSync(ERROR_LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
    } catch {}
  },
  print: (message = "") => {
    console.log(message);
  },
};
