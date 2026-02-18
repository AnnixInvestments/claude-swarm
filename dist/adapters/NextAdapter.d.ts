import { DevServerAdapter } from "./DevServerAdapter.js";
export declare class NextAdapter extends DevServerAdapter {
    readonly name = "next";
    protected readonly startArgs: string[];
    protected readonly processPattern = "next dev";
    constructor(cwd: string, port?: number);
}
//# sourceMappingURL=NextAdapter.d.ts.map