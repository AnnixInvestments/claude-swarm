import { DevServerAdapter } from "./DevServerAdapter.js";
export class NextAdapter extends DevServerAdapter {
    name = "next";
    startArgs = ["npx", "next", "dev"];
    processPattern = "next dev";
    constructor(cwd, port = 3000) {
        super(cwd, port);
    }
}
//# sourceMappingURL=NextAdapter.js.map