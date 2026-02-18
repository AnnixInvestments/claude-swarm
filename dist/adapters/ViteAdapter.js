import { DevServerAdapter } from "./DevServerAdapter.js";
export class ViteAdapter extends DevServerAdapter {
    name = "vite";
    startArgs = ["npx", "vite"];
    processPattern = "vite";
    constructor(cwd, port = 5173) {
        super(cwd, port);
    }
}
//# sourceMappingURL=ViteAdapter.js.map