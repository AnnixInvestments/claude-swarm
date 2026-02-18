import { DevServerAdapter } from "./DevServerAdapter.js";
export declare class NestAdapter extends DevServerAdapter {
    readonly name = "nest";
    protected readonly startArgs: string[];
    protected readonly processPattern = "nest.* start";
    constructor(cwd: string, port?: number);
}
//# sourceMappingURL=NestAdapter.d.ts.map