export interface Env {
  PRESENCE_HUB: DurableObjectNamespace;
}

interface ConnectionInfo {
  deviceId: string;
  label: string;
  peers: string[];
}

interface InviteRecord {
  inviteId: string;
  creatorDeviceId: string;
  creatorLabel: string;
  createdAt: number;
  expiresAt: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    const id = env.PRESENCE_HUB.idFromName("presence-hub");
    return env.PRESENCE_HUB.get(id).fetch(request);
  }
};

export class PresenceHub {
  private readonly state: DurableObjectState;
  private readonly connections = new Map<string, WebSocket>();

  constructor(state: DurableObjectState) {
    this.state = state;

    for (const socket of this.state.getWebSockets()) {
      const info = this.readConnectionInfo(socket);
      if (info?.deviceId) {
        this.connections.set(info.deviceId, socket);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json(
        {
          error: "WebSocket upgrade required."
        },
        426
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      deviceId: "",
      label: "",
      peers: []
    } satisfies ConnectionInfo);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      this.send(socket, {
        type: "error",
        code: "bad_json",
        message: "Message was not valid JSON."
      });
      return;
    }

    if (parsed.type === "hello") {
      this.handleHello(socket, parsed);
      return;
    }

    if (parsed.type === "create-invite") {
      await this.handleCreateInvite(socket, parsed);
      return;
    }

    if (parsed.type === "join-invite") {
      await this.handleJoinInvite(socket, parsed);
      return;
    }

    if (parsed.type === "signal") {
      this.handleSignal(socket, parsed);
      return;
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const connection = this.readConnectionInfo(socket);
    if (!connection?.deviceId) {
      return;
    }

    this.connections.delete(connection.deviceId);
    for (const peerId of connection.peers) {
      const peerSocket = this.connections.get(peerId);
      if (!peerSocket) {
        continue;
      }

      this.send(peerSocket, {
        type: "peer-offline",
        peerDeviceId: connection.deviceId
      });
    }
  }

  async alarm(): Promise<void> {
    const invites = await this.state.storage.list<InviteRecord>({ prefix: "invite:" });
    const now = Date.now();
    let nextExpiry = 0;

    for (const [key, invite] of invites) {
      if (invite.expiresAt <= now) {
        await this.state.storage.delete(key);
      } else if (!nextExpiry || invite.expiresAt < nextExpiry) {
        nextExpiry = invite.expiresAt;
      }
    }

    if (nextExpiry) {
      await this.state.storage.setAlarm(nextExpiry);
    }
  }

  private handleHello(socket: WebSocket, message: any): void {
    const info = {
      deviceId: String(message.deviceId || "").trim(),
      label: String(message.label || "Nearby device").trim(),
      peers: Array.isArray(message.peers)
        ? [...new Set(message.peers.map((value: unknown) => String(value || "").trim()).filter(Boolean))]
        : []
    } satisfies ConnectionInfo;

    if (!info.deviceId) {
      this.send(socket, {
        type: "error",
        code: "missing_device_id",
        message: "Device id is required."
      });
      return;
    }

    const current = this.connections.get(info.deviceId);
    if (current && current !== socket) {
      try {
        current.close(1012, "Replaced by a newer connection");
      } catch {
        // Ignore close errors.
      }
    }

    socket.serializeAttachment(info);
    this.connections.set(info.deviceId, socket);

    for (const peerId of info.peers) {
      const peerSocket = this.connections.get(peerId);
      if (!peerSocket) {
        continue;
      }

      const peerInfo = this.readConnectionInfo(peerSocket);
      if (!peerInfo?.deviceId) {
        continue;
      }

      this.send(socket, {
        type: "peer-online",
        peerDeviceId: peerInfo.deviceId,
        peerLabel: peerInfo.label
      });

      if (peerInfo.peers.includes(info.deviceId)) {
        this.send(peerSocket, {
          type: "peer-online",
          peerDeviceId: info.deviceId,
          peerLabel: info.label
        });
      }
    }
  }

  private async handleCreateInvite(socket: WebSocket, message: any): Promise<void> {
    const info = this.readConnectionInfo(socket);
    const creatorDeviceId = info?.deviceId || String(message.deviceId || "").trim();
    const creatorLabel = info?.label || String(message.label || "Nearby device").trim();

    if (!creatorDeviceId) {
      this.send(socket, {
        type: "error",
        code: "missing_device_id",
        message: "Join the relay before creating an invite."
      });
      return;
    }

    const createdAt = Date.now();
    const invite: InviteRecord = {
      inviteId: createInviteId(),
      creatorDeviceId,
      creatorLabel,
      createdAt,
      expiresAt: createdAt + 10 * 60 * 1000
    };

    await this.state.storage.put(`invite:${invite.inviteId}`, invite);
    await this.state.storage.setAlarm(invite.expiresAt);

    this.send(socket, {
      type: "invite-created",
      inviteId: invite.inviteId,
      expiresAt: new Date(invite.expiresAt).toISOString()
    });
  }

  private async handleJoinInvite(socket: WebSocket, message: any): Promise<void> {
    const inviteId = String(message.inviteId || "").trim();
    if (!inviteId) {
      this.send(socket, {
        type: "error",
        code: "invite_missing",
        message: "Invite id is required."
      });
      return;
    }

    const invite = await this.state.storage.get<InviteRecord>(`invite:${inviteId}`);
    if (!invite || invite.expiresAt <= Date.now()) {
      if (invite) {
        await this.state.storage.delete(`invite:${inviteId}`);
      }
      this.send(socket, {
        type: "error",
        code: "invite_not_found",
        message: "Invite expired."
      });
      return;
    }

    const joiner = this.readConnectionInfo(socket) || {
      deviceId: String(message.deviceId || "").trim(),
      label: String(message.label || "Nearby device").trim(),
      peers: []
    };

    if (!joiner.deviceId) {
      this.send(socket, {
        type: "error",
        code: "missing_device_id",
        message: "Join the relay before using an invite."
      });
      return;
    }

    const creatorSocket = this.connections.get(invite.creatorDeviceId);
    if (!creatorSocket) {
      this.send(socket, {
        type: "error",
        code: "creator_offline",
        message: "The device that created this invite is offline."
      });
      return;
    }

    const creator = this.readConnectionInfo(creatorSocket) || {
      deviceId: invite.creatorDeviceId,
      label: invite.creatorLabel,
      peers: []
    };

    await this.state.storage.delete(`invite:${inviteId}`);

    this.send(creatorSocket, {
      type: "invite-joined",
      inviteId,
      peerDeviceId: joiner.deviceId,
      peerLabel: joiner.label
    });
    this.send(socket, {
      type: "invite-joined",
      inviteId,
      peerDeviceId: creator.deviceId,
      peerLabel: creator.label
    });
  }

  private handleSignal(socket: WebSocket, message: any): void {
    const from = this.readConnectionInfo(socket);
    const toDeviceId = String(message.toDeviceId || "").trim();
    const sessionId = String(message.sessionId || "").trim();
    const targetSocket = this.connections.get(toDeviceId);

    if (!from?.deviceId || !toDeviceId || !sessionId || !targetSocket) {
      return;
    }

    this.send(targetSocket, {
      type: "signal",
      fromDeviceId: from.deviceId,
      sessionId,
      payload: message.payload || null
    });
  }

  private readConnectionInfo(socket: WebSocket): ConnectionInfo | null {
    try {
      return (socket.deserializeAttachment() as ConnectionInfo) || null;
    } catch {
      return null;
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Ignore send errors for stale sockets.
    }
  }
}

function createInviteId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
