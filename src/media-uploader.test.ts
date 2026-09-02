import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveMediaFile } from "./media-uploader.js";

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("outbound media loading", () => {
  it("blocks loopback URLs before making a request", async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from("not-a-real-image"));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server address missing");

    await expect(resolveMediaFile(`http://127.0.0.1:${address.port}/private.png`)).rejects.toThrow();
    expect(requestCount).toBe(0);
  });

  it("reads local media only from an explicitly allowed root", async () => {
    const allowedDir = await mkdtemp(path.join(tmpdir(), "wecom-media-allowed-"));
    const deniedDir = await mkdtemp(path.join(tmpdir(), "wecom-media-denied-"));
    tempDirs.push(allowedDir, deniedDir);
    const allowedFile = path.join(allowedDir, "allowed.txt");
    const deniedFile = path.join(deniedDir, "denied.txt");
    await writeFile(allowedFile, "allowed");
    await writeFile(deniedFile, "denied");

    await expect(resolveMediaFile(allowedFile, [allowedDir])).resolves.toMatchObject({
      buffer: Buffer.from("allowed"),
      fileName: "allowed.txt",
    });
    await expect(resolveMediaFile(deniedFile, [allowedDir])).rejects.toThrow(
      /allowed directory|allowlisted local roots|not under/i,
    );
  });
});
