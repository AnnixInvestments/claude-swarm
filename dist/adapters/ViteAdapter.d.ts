import { DevServerAdapter } from "./DevServerAdapter.js";
export declare class ViteAdapter extends DevServerAdapter {
    readonly name = "vite";
    protected readonly startArgs: string[];
    protected readonly processPattern = "vite";
    constructor(cwd: string, port?: number);
}
//# sourceMappingURL=ViteAdapter.d.ts.map