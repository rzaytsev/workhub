import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { TodoStore } from "./store.js";
import { execute } from "./operations.js";

const store = new TodoStore();
const token = randomBytes(32).toString("hex");
const port = Number(process.env.PORT || 4317);
const origin = `http://127.0.0.1:${port}`;
const html = (
  await readFile(new URL("../dist/app/index.html", import.meta.url), "utf8")
).replace(
  "<head>",
  `<head><script>window.__TODO_PREVIEW__=${JSON.stringify({ token })};</script>`,
);
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (
    req.headers.host !== `127.0.0.1:${port}` ||
    (req.headers.origin && req.headers.origin !== origin)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (req.url === "/" && req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
    return;
  }
  if (req.url !== "/api/tool" || req.method !== "POST") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (
    req.headers["x-todo-token"] !== token ||
    req.headers["content-type"] !== "application/json"
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 1500000) throw Error("Request too large.");
    }
    const { name, arguments: args } = JSON.parse(body);
    const data = await execute(store, name, args);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ structuredContent: data, content: [] }));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      }),
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  process.stderr.write(`Workhub preview: ${origin}\n`),
);
