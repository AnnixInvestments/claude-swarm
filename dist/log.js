import chalk from "chalk";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
export const log = {
    debug: (message) => {
        if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.debug) {
            console.log(chalk.dim(message));
        }
    },
    info: (message) => {
        if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.info) {
            console.log(chalk.green(message));
        }
    },
    warn: (message) => {
        if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.warn) {
            console.log(chalk.yellow(message));
        }
    },
    error: (message) => {
        console.error(chalk.red(message));
    },
    print: (message = "") => {
        console.log(message);
    },
};
//# sourceMappingURL=log.js.map