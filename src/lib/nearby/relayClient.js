export class NearbyRelayClient extends EventTarget {
  constructor({ url, deviceId, label, appVersion }) {
    super();
    this.url = url;
    this.deviceId = deviceId;
    this.label = label;
    this.appVersion = appVersion;
    this.peerIds = [];
    this.socket = null;
    this.started = false;
    this.status = "idle";
    this.backoffMs = 1000;
    this.reconnectTimer = 0;
    this.pingTimer = 0;
  }

  setIdentity({ deviceId, label }) {
    this.deviceId = deviceId;
    this.label = label;
    if (this.isConnected()) {
      this.sendHello();
    }
  }

  setPeerIds(peerIds) {
    this.peerIds = [...new Set(peerIds.filter(Boolean))].sort();
    if (this.isConnected()) {
      this.sendHello();
    }
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start() {
    this.started = true;
    this.connect();
  }

  stop() {
    this.started = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.reconnectTimer = 0;
    this.pingTimer = 0;

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.updateStatus("idle");
  }

  connect() {
    if (!this.url || !this.started) {
      return;
    }

    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return;
    }

    this.updateStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.backoffMs = 1000;
      this.updateStatus("connected");
      this.sendHello();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        this.send({
          type: "presence-ping"
        });
      }, 20_000);
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data || ""));
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      } catch (error) {
        console.error("Failed to parse relay message", error);
      }
    });

    socket.addEventListener("close", () => {
      window.clearInterval(this.pingTimer);
      this.pingTimer = 0;
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.started) {
        this.updateStatus("disconnected");
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
      this.updateStatus("error");
    });
  }

  createInvite() {
    this.send({
      type: "create-invite",
      deviceId: this.deviceId,
      label: this.label
    });
  }

  joinInvite(inviteId) {
    this.send({
      type: "join-invite",
      inviteId,
      deviceId: this.deviceId,
      label: this.label
    });
  }

  sendSignal(toDeviceId, sessionId, payload) {
    this.send({
      type: "signal",
      toDeviceId,
      sessionId,
      payload
    });
  }

  sendHello() {
    this.send({
      type: "hello",
      deviceId: this.deviceId,
      label: this.label,
      peers: this.peerIds,
      appVersion: this.appVersion
    });
  }

  send(message) {
    if (!this.isConnected()) {
      return false;
    }

    this.socket.send(JSON.stringify(message));
    return true;
  }

  scheduleReconnect() {
    if (!this.started || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 20_000);
  }

  updateStatus(status) {
    if (this.status === status) {
      return;
    }

    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: status }));
  }
}
