import { DevServerAdapter } from "./DevServerAdapter.js";
export class NestAdapter extends DevServerAdapter {
    name = "nest";
    startArgs = ["npx", "nest", "start", "--watch"];
    processPattern = "nest.* start";
    constructor(cwd, port = 3000) {
        super(cwd, port);
    }
}
//# sourceMappingURL=NestAdapter.js.map