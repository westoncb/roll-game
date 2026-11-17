import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const levels = new URL("../levels/", import.meta.url);
const levelFile = /^[a-z0-9][a-z0-9_-]{0,99}\.json$/;
const maxBytes = 4 * 1024 * 1024;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function saveLevel(request: IncomingMessage, response: ServerResponse, file: URL) {
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
      return json(response, 413, { error: "Level exceeds 4 MiB." });
    }
    chunks.push(chunk);
  }

  let level: unknown;
  try {
    level = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { error: "Invalid JSON." });
  }
  if (level === null || typeof level !== "object" || Array.isArray(level)) {
    return json(response, 400, { error: "Expected a level object." });
  }

  const temporary = new URL(`${randomUUID()}.tmp`, levels);
  try {
    await writeFile(temporary, JSON.stringify(level, null, 2) + "\n", { flag: "wx" });
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
      .filter((file) => file.isFile() && levelFile.test(file.name))
      .map((file) => file.name.slice(0, -".json".length));
    return json(response, 200, ids.sort());
  }

  const prefix = "/api/levels/";
  const filename = path.slice(prefix.length) + ".json";
  if (!path.startsWith(prefix) || !levelFile.test(filename)) {
    return json(response, 404, { error: "Unknown route or level ID." });
  }

  const file = new URL(filename, levels);
  if (request.method === "PUT") return saveLevel(request, response, file);
  if (request.method === "GET") {
    const levelFileHandle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const level = await levelFileHandle.readFile("utf8");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      response.end(level);
    } finally {
      await levelFileHandle.close();
    }
    return;
  }
  response.setHeader("Allow", "GET, PUT");
  json(response, 405, { error: "Use GET or PUT for a level." });
}

createServer((request, response) => {
  handle(request, response).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ELOOP") {
      return json(response, 404, { error: "Level not found." });
    }
    console.error(error);
    json(response, 500, { error: "Level storage failed." });
  });
}).listen(3001, "127.0.0.1", () => {
  console.log("Level API listening at http://127.0.0.1:3001");
});
