import { execSync } from "node:child_process";
export class DevServerAdapter {
    cwd;
    port;
    constructor(cwd, port) {
        this.cwd = cwd;
        this.port = port;
    }
    async start() {
        const { spawn } = await import("node:child_process");
        const [cmd, ...args] = this.startArgs;
        const proc = spawn(cmd, args, {
            cwd: this.cwd,
            stdio: "ignore",
            detached: true,
        });
        proc.unref();
    }
    async stop() {
        try {
            execSync(`pkill -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
        }
        catch { }
    }
    async kill() {
        try {
            execSync(`pkill -9 -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
        }
        catch { }
    }
    async isRunning() {
        try {
            const result = execSync(`lsof -i :${this.port} -sTCP:LISTEN 2>/dev/null | grep -c LISTEN`, {
                encoding: "utf-8",
                stdio: "pipe",
            }).trim();
            return Number.parseInt(result, 10) > 0;
        }
        catch {
            return false;
        }
    }
    logFile() {
        return null;
    }
}
//# sourceMappingURL=DevServerAdapter.js.map