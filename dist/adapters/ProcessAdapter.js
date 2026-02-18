import { execSync, spawn } from "node:child_process";
export class ProcessAdapter {
    name;
    process = null;
    config;
    constructor(config) {
        this.name = config.name;
        this.config = config;
    }
    async start() {
        if (await this.isRunning()) {
            return;
        }
        this.process = spawn(this.config.command, this.config.args, {
            cwd: this.config.cwd,
            stdio: "ignore",
            detached: true,
        });
        this.process.unref();
        this.process.on("exit", () => {
            this.process = null;
        });
        const timeoutMs = this.config.readyTimeoutMs ?? 120000;
        const pollIntervalMs = 2000;
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            if (await this.isRunning()) {
                return;
            }
        }
        throw new Error(`${this.name} did not start within ${timeoutMs}ms`);
    }
    async stop() {
        if (this.process?.pid) {
            process.kill(this.process.pid, "SIGTERM");
            this.process = null;
        }
    }
    async kill() {
        if (this.process?.pid) {
            process.kill(this.process.pid, "SIGKILL");
            this.process = null;
        }
    }
    async isRunning() {
        if (this.process !== null) {
            return true;
        }
        try {
            const result = execSync(`pgrep -f "${this.config.command} ${this.config.args.join(" ")}" 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).trim();
            return result !== "";
        }
        catch {
            return false;
        }
    }
    logFile() {
        return null;
    }
}
//# sourceMappingURL=ProcessAdapter.js.map