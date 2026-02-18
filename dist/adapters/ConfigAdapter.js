import { execSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
export class ConfigAdapter {
    name;
    config;
    cwd;
    constructor(config, cwd) {
        this.name = config.name;
        this.config = config;
        this.cwd = cwd;
    }
    logFile() {
        return join(this.cwd, `.claude-swarm-${this.name}.log`);
    }
    async start() {
        const logPath = this.logFile();
        const logStream = createWriteStream(logPath, { flags: "a" });
        if (!this.config.readyPattern) {
            const proc = spawn(this.config.start, [], {
                cwd: this.cwd,
                stdio: ["ignore", "pipe", "pipe"],
                detached: true,
                shell: true,
            });
            proc.stdout?.pipe(logStream);
            proc.stderr?.pipe(logStream);
            proc.unref();
            return;
        }
        const pattern = new RegExp(this.config.readyPattern);
        const timeoutMs = 120000;
        await new Promise((resolve, reject) => {
            const proc = spawn(this.config.start, [], {
                cwd: this.cwd,
                stdio: ["ignore", "pipe", "pipe"],
                detached: true,
                shell: true,
            });
            proc.stdout?.pipe(logStream, { end: false });
            proc.stderr?.pipe(logStream, { end: false });
            let settled = false;
            const finish = (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                proc.unref();
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            };
            const checkOutput = (data) => {
                if (pattern.test(data.toString())) {
                    finish();
                }
            };
            proc.stdout?.on("data", checkOutput);
            proc.stderr?.on("data", checkOutput);
            proc.on("error", (err) => finish(err));
            const timer = setTimeout(() => finish(new Error(`${this.name} did not start within ${timeoutMs}ms`)), timeoutMs);
        });
    }
    async stop() {
        if (this.config.stop.startsWith("signal:")) {
            const signal = this.config.stop.replace("signal:", "");
            this.sendSignalToChildren(signal);
        }
        else {
            try {
                execSync(this.config.stop, { cwd: this.cwd, stdio: "pipe" });
            }
            catch { }
        }
    }
    async kill() {
        if (this.config.kill.startsWith("signal:")) {
            const signal = this.config.kill.replace("signal:", "");
            this.sendSignalToChildren(signal);
        }
        else {
            try {
                execSync(this.config.kill, { cwd: this.cwd, stdio: "pipe" });
            }
            catch { }
        }
    }
    async isRunning() {
        try {
            const result = execSync(`pgrep -f "${this.config.start}" 2>/dev/null`, {
                encoding: "utf-8",
                stdio: "pipe",
            }).trim();
            return result !== "";
        }
        catch {
            return false;
        }
    }
    sendSignalToChildren(signal) {
        try {
            execSync(`pkill -${signal} -f "${this.config.start}" 2>/dev/null`, { stdio: "pipe" });
        }
        catch { }
    }
}
//# sourceMappingURL=ConfigAdapter.js.map