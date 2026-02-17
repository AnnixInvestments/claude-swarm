import { DevServerAdapter } from "./DevServerAdapter.js";

export class NestAdapter extends DevServerAdapter {
  readonly name = "nest";
  protected readonly startArgs = ["npx", "nest", "start", "--watch"];
  protected readonly processPattern = "nest.* start";

  constructor(cwd: string, port = 3000) {
    super(cwd, port);
  }
}
