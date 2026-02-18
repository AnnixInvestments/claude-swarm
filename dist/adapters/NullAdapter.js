export class NullAdapter {
    name = "null";
    async start() { }
    async stop() { }
    async kill() { }
    async isRunning() {
        return false;
    }
    logFile() {
        return null;
    }
}
//# sourceMappingURL=NullAdapter.js.map