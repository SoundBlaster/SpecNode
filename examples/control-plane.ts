import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type {
  AgentDescriptor,
  BridgePolicy,
  Envelope,
  NodeHelloPayload,
  RunEvent,
  SessionStartPayload,
  WorkspaceDescriptor,
} from "../src/index.js";

const PORT = Number(process.env.PORT ?? 8787);
const DEV_BRIDGE_TOKEN = process.env.SPECNODE_DEV_TOKEN ?? "dev";

interface BridgeConnection {
  readonly socket: WebSocket;
  hello?: NodeHelloPayload;
}

interface BrowserEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

let bridge: BridgeConnection | undefined;
const browserClients = new Set<ServerResponse>();
const sessions = new Map<string, SessionStartPayload>();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, pageHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, statusPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/browser/events") {
      attachBrowserEvents(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      await startSession(request, response);
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const bridgeServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== "/bridge/connect") {
    socket.destroy();
    return;
  }

  if (url.searchParams.get("token") !== DEV_BRIDGE_TOKEN) {
    socket.destroy();
    return;
  }

  bridgeServer.handleUpgrade(request, socket, head, (webSocket) => {
    bridgeServer.emit("connection", webSocket, request);
  });
});

bridgeServer.on("connection", (socket) => {
  bridge = { socket };
  broadcast({ type: "bridge.connected" });

  socket.on("message", (data) => {
    const message = parseEnvelope(data.toString());

    if (message.type === "node.hello") {
      bridge = { socket, hello: message.payload as NodeHelloPayload };
      broadcast({ type: "bridge.hello", node: bridge.hello });
      return;
    }

    if (message.type === "session.event") {
      const payload = message.payload as { sessionId: string; event: RunEvent };
      broadcast({ type: "session.event", ...payload });
      return;
    }

    broadcast({ type: "bridge.unknown_message", messageType: message.type });
  });

  socket.on("close", () => {
    if (bridge?.socket === socket) {
      bridge = undefined;
    }
    broadcast({ type: "bridge.disconnected" });
  });

  socket.on("error", (error) => {
    broadcast({ type: "bridge.error", message: error.message });
  });
});

server.listen(PORT, () => {
  console.log(`SpecNode control-plane example: http://localhost:${PORT}`);
  console.log(`Bridge URL: ws://localhost:${PORT}/bridge/connect?token=${DEV_BRIDGE_TOKEN}`);
});

async function startSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!bridge || bridge.socket.readyState !== WebSocket.OPEN || !bridge.hello) {
    sendJson(response, 409, { error: "bridge_not_ready" });
    return;
  }

  const body = await readJson(request);
  const sessionId = randomUUID();
  const agentId = String(body.agentId ?? bridge.hello.agents[0]?.id ?? "demo-agent");
  const workspaceId = String(body.workspaceId ?? bridge.hello.workspaces[0]?.id ?? "current");
  const goal = String(body.goal ?? "Inspect the repository and explain what you would do next.");

  const payload: SessionStartPayload = {
    sessionId,
    agentId,
    workspaceId,
    task: {
      kind: String(body.kind ?? "repository.demo"),
      goal,
      inputs: typeof body.inputs === "object" && body.inputs !== null ? body.inputs : undefined,
    },
    policy: normalizePolicy(body.policy),
  };

  sessions.set(sessionId, payload);
  bridge.socket.send(JSON.stringify(envelope("session.start", payload)));

  broadcast({ type: "session.queued", sessionId, agentId, workspaceId, goal });
  sendJson(response, 202, { sessionId });
}

function normalizePolicy(input: unknown): BridgePolicy {
  if (typeof input !== "object" || input === null) {
    return { filesystem: "workspace-read", shell: "ask", network: "deny" };
  }

  const maybe = input as Partial<BridgePolicy>;
  return {
    filesystem: maybe.filesystem ?? "workspace-read",
    shell: maybe.shell ?? "ask",
    network: maybe.network ?? "deny",
  };
}

function statusPayload(): {
  bridgeOnline: boolean;
  node?: NodeHelloPayload;
  agents: readonly AgentDescriptor[];
  workspaces: readonly WorkspaceDescriptor[];
  sessions: readonly string[];
} {
  return {
    bridgeOnline: bridge?.socket.readyState === WebSocket.OPEN,
    node: bridge?.hello,
    agents: bridge?.hello?.agents ?? [],
    workspaces: bridge?.hello?.workspaces ?? [],
    sessions: [...sessions.keys()],
  };
}

function broadcast(event: BrowserEvent): void {
  const data = `data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}\n\n`;

  for (const client of browserClients) {
    client.write(data);
  }
}

function attachBrowserEvents(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.write("retry: 1000\n\n");
  browserClients.add(response);
  response.on("close", () => browserClients.delete(response));
}

function envelope<TPayload>(type: string, payload: TPayload): Envelope<TPayload> {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function parseEnvelope(raw: string): Envelope<unknown> {
  const value = JSON.parse(raw) as Partial<Envelope<unknown>>;

  if (!value.id || !value.type || !value.timestamp || value.payload === undefined) {
    throw new Error("Invalid bridge envelope");
  }

  return value as Envelope<unknown>;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SpecNode BYOA Bridge Demo</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; max-width: 960px; }
    label { display: block; margin: 12px 0 6px; font-weight: 600; }
    input, textarea, select, button { font: inherit; padding: 8px; }
    textarea { width: 100%; min-height: 96px; }
    pre { background: #111; color: #eee; padding: 16px; overflow: auto; border-radius: 8px; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .pill { border: 1px solid #ccc; border-radius: 999px; padding: 4px 10px; }
  </style>
</head>
<body>
  <h1>SpecNode BYOA Bridge Demo</h1>
  <p>The browser talks to this control plane. The local bridge connects outbound over WebSocket.</p>

  <div class="row">
    <span id="bridgeStatus" class="pill">Bridge: unknown</span>
    <button id="refresh">Refresh status</button>
  </div>

  <label for="agent">Agent</label>
  <select id="agent"></select>

  <label for="workspace">Workspace</label>
  <select id="workspace"></select>

  <label for="goal">Task goal</label>
  <textarea id="goal">Review the current repository context and produce a safe next-step plan.</textarea>

  <button id="start">Start session</button>

  <h2>Events</h2>
  <pre id="events"></pre>

  <script type="module">
    const statusEl = document.getElementById("bridgeStatus");
    const agentEl = document.getElementById("agent");
    const workspaceEl = document.getElementById("workspace");
    const goalEl = document.getElementById("goal");
    const eventsEl = document.getElementById("events");

    function append(value) {
      eventsEl.textContent += JSON.stringify(value, null, 2) + "\\n";
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }

    async function refreshStatus() {
      const status = await fetch("/api/status").then((response) => response.json());
      statusEl.textContent = status.bridgeOnline ? "Bridge: online" : "Bridge: offline";
      agentEl.innerHTML = "";
      workspaceEl.innerHTML = "";

      for (const agent of status.agents) {
        const option = document.createElement("option");
        option.value = agent.id;
        option.textContent = agent.displayName ?? agent.id;
        agentEl.appendChild(option);
      }

      for (const workspace of status.workspaces) {
        const option = document.createElement("option");
        option.value = workspace.id;
        option.textContent = workspace.name;
        workspaceEl.appendChild(option);
      }
    }

    document.getElementById("refresh").addEventListener("click", refreshStatus);

    document.getElementById("start").addEventListener("click", async () => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agentEl.value,
          workspaceId: workspaceEl.value,
          goal: goalEl.value,
          policy: { filesystem: "workspace-read", shell: "ask", network: "deny" }
        })
      });
      append(await response.json());
      await refreshStatus();
    });

    const events = new EventSource("/browser/events");
    events.onmessage = (event) => append(JSON.parse(event.data));

    await refreshStatus();
  </script>
</body>
</html>`;
}
