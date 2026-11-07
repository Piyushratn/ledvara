import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "../..");
const mainJs = join(apiRoot, "dist/main.js");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** The compiled API as a real child process, so it can be killed the way a crash would kill it. */
export class ApiProcess {
  readonly url: string;
  private child: ChildProcess | undefined;
  private output = "";

  constructor(
    private readonly port: number,
    private readonly env: Record<string, string>,
  ) {
    this.url = `http://127.0.0.1:${port}`;
  }

  async start(): Promise<void> {
    if (!existsSync(mainJs)) {
      throw new Error("apps/api/dist/main.js not found. Run `pnpm build` first.");
    }
    await this.kill();
    this.output = "";

    const child = spawn(process.execPath, [mainJs], {
      cwd: apiRoot,
      env: { ...process.env, ...this.env, PORT: String(this.port), LOG_LEVEL: "silent" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const collect = (chunk: Buffer): void => {
      this.output = (this.output + chunk.toString()).slice(-4000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let exited = false;
    child.once("exit", () => {
      exited = true;
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`The API exited during startup:\n${this.output}`);
      try {
        const res = await fetch(`${this.url}/healthz`);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      await sleep(200);
    }
    throw new Error(`The API did not become healthy within 30s:\n${this.output}`);
  }

  /** SIGKILL: no shutdown handler runs, open transactions are simply abandoned. */
  async kill(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await done;
  }
}
