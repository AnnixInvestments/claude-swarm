import { DevServerAdapter } from "./DevServerAdapter.js";

export class NextAdapter extends DevServerAdapter {
  readonly name = "next";
  protected readonly startArgs = ["npx", "next", "dev"];
  protected readonly processPattern = "next dev";

  constructor(cwd: string, port = 3000) {
    super(cwd, port);
  }
}
