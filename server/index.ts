import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { readParticleEffect } from "../client/src/assets/particle-effect.ts";

const particles = new URL("../assets/particles/", import.meta.url);
const levels = new URL("../levels/", import.meta.url);
const assetFile = /^[a-z0-9][a-z0-9_-]{0,99}\.json$/;
const maxBytes = 4 * 1024 * 1024;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function saveAsset(
  request: IncomingMessage,
  response: ServerResponse,
  file: URL,
  particle: boolean
) {
  if (
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return json(response, 415, { error: "Expected application/json." });
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      return json(response, 413, { error: "Asset exceeds 4 MiB." });
    }
    chunks.push(chunk);
  }

  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { error: "Invalid JSON." });
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return json(response, 400, { error: "Expected an asset object." });
  }

  if (particle) {
    try {
      readParticleEffect(data, file.pathname.split("/").pop()!);
    } catch (cause) {
      return json(response, 400, {
        error: cause instanceof Error ? cause.message : "Invalid particle effect."
      });
    }
  }
  const temporary = new URL(`${randomUUID()}.tmp`, file);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  response.writeHead(204).end();
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host?.split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") {
    return json(response, 403, { error: "Use a local server address." });
  }
  const path = (request.url ?? "").split("?")[0];
  if (path === "/api/levels") {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return json(response, 405, { error: "Use GET to list levels." });
    }
    const files = await readdir(levels, { withFileTypes: true });
    const ids = files
      .filter((file) => file.isFile() && assetFile.test(file.name))
      .map((file) => file.name.slice(0, -".json".length));
    return json(response, 200, ids.sort());
  }

  const particle = path.startsWith("/api/particles/");
  const prefix = particle ? "/api/particles/" : "/api/levels/";
  const filename = path.slice(prefix.length) + ".json";
  if (!path.startsWith(prefix) || !assetFile.test(filename)) {
    return json(response, 404, { error: "Unknown route or asset ID." });
  }

  const file = new URL(filename, particle ? particles : levels);
  if (request.method === "PUT") return saveAsset(request, response, file, particle);
  if (request.method === "GET") {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const contents = await handle.readFile("utf8");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      response.end(contents);
    } finally {
      await handle.close();
    }
    return;
  }
  response.setHeader("Allow", "GET, PUT");
  json(response, 405, { error: "Use GET or PUT for an asset." });
}

createServer((request, response) => {
  handle(request, response).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ELOOP") {
      return json(response, 404, { error: "Asset not found." });
    }
    console.error(error);
    json(response, 500, { error: "Asset storage failed." });
  });
}).listen(3001, "127.0.0.1", () => {
  console.log("Asset API listening at http://127.0.0.1:3001");
});
