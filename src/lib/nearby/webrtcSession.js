export class NearbyWebRtcSession extends EventTarget {
  constructor({
    sessionId,
    remoteDeviceId,
    relayClient,
    initiator,
    mode
  }) {
    super();
    this.sessionId = sessionId;
    this.remoteDeviceId = remoteDeviceId;
    this.relayClient = relayClient;
    this.initiator = initiator;
    this.mode = mode;
    this.connection = new RTCPeerConnection({
      iceServers: []
    });
    this.channel = null;
    this.idleTimer = 0;
    this.closed = false;

    this.connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        return;
      }

      this.relayClient.sendSignal(this.remoteDeviceId, this.sessionId, {
        type: "candidate",
        mode: this.mode,
        candidate: event.candidate
      });
    });

    this.connection.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(this.connection.connectionState)) {
        this.close();
      }
    });

    this.connection.addEventListener("datachannel", (event) => {
      this.attachChannel(event.channel);
    });
  }

  async start() {
    if (this.initiator) {
      this.attachChannel(
        this.connection.createDataChannel("library-sync", {
          ordered: true
        })
      );
      const offer = await this.connection.createOffer();
      await this.connection.setLocalDescription(offer);
      this.relayClient.sendSignal(this.remoteDeviceId, this.sessionId, {
        type: "offer",
        mode: this.mode,
        description: offer
      });
    }
  }

  async handleSignal(payload) {
    if (this.closed || !payload) {
      return;
    }

    if (payload.type === "offer") {
      await this.connection.setRemoteDescription(new RTCSessionDescription(payload.description));
      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);
      this.relayClient.sendSignal(this.remoteDeviceId, this.sessionId, {
        type: "answer",
        mode: this.mode,
        description: answer
      });
      return;
    }

    if (payload.type === "answer") {
      await this.connection.setRemoteDescription(new RTCSessionDescription(payload.description));
      return;
    }

    if (payload.type === "candidate" && payload.candidate) {
      try {
        await this.connection.addIceCandidate(payload.candidate);
      } catch (error) {
        console.error("Failed to apply ICE candidate", error);
      }
    }
  }

  sendJson(message) {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("Nearby sync channel is not open.");
    }

    this.bumpIdleTimer();
    this.channel.send(JSON.stringify(message));
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;

    if (this.channel) {
      this.channel.close();
    }
    this.connection.close();
    this.dispatchEvent(new CustomEvent("close"));
  }

  attachChannel(channel) {
    this.channel = channel;
    channel.addEventListener("open", () => {
      this.bumpIdleTimer();
      this.dispatchEvent(new CustomEvent("open", { detail: { channel } }));
    });
    channel.addEventListener("close", () => this.close());
    channel.addEventListener("message", (event) => {
      this.bumpIdleTimer();
      try {
        const message = JSON.parse(String(event.data || ""));
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      } catch (error) {
        console.error("Failed to parse data channel message", error);
      }
    });
  }

  bumpIdleTimer() {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.close();
    }, 10_000);
  }
}
