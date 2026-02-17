import { DevServerAdapter } from "./DevServerAdapter.js";

export class ViteAdapter extends DevServerAdapter {
  readonly name = "vite";
  protected readonly startArgs = ["npx", "vite"];
  protected readonly processPattern = "vite";

  constructor(cwd: string, port = 5173) {
    super(cwd, port);
  }
}
