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
        const isWindows = process.platform === "win32";
        if (isWindows) {
            try {
                execSync(`powershell -Command "$conn = Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue }"`, { stdio: "pipe" });
            }
            catch { }
            return;
        }
        try {
            execSync(`pkill -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
        }
        catch { }
    }
    async kill() {
        const isWindows = process.platform === "win32";
        if (isWindows) {
            try {
                execSync(`powershell -Command "$conn = Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"`, { stdio: "pipe" });
            }
            catch { }
            return;
        }
        try {
            execSync(`pkill -9 -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
        }
        catch { }
    }
    async isRunning() {
        const isWindows = process.platform === "win32";
        if (isWindows) {
            try {
                const result = execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1"`, { encoding: "utf-8", stdio: "pipe" }).trim();
                return result !== "";
            }
            catch {
                return false;
            }
        }
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