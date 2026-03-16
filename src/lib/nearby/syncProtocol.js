import {
  exportPaperTransferPayload,
  getPaperManifestEntries,
  importPaperTransferPayload
} from "../db";
import { comparePaperVersions } from "./merge";

const CHUNK_SIZE = 48 * 1024;
const PDF_INLINE_SYNC_LIMIT_BYTES = 50 * 1024 * 1024;

export async function runPairSession(session, { localDevice, onPaired }) {
  const isInitiator = session.initiator;
  let pendingPairInit = null;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      session.removeEventListener("open", handleOpen);
      session.removeEventListener("message", handleMessage);
      session.removeEventListener("close", handleClose);
    };

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const handleOpen = async () => {
      if (!isInitiator) {
        return;
      }

      const pairSecret = await createPairSecret();
      const pairId = await buildPairId(localDevice.deviceId, session.remoteDeviceId);
      pendingPairInit = {
        pairId,
        pairSecret
      };
      session.sendJson({
        type: "pair-init",
        pairId,
        pairSecret,
        device: localDevice
      });
    };

    const handleMessage = async (event) => {
      const message = event.detail;
      if (message.type === "pair-init") {
        const pairRecord = await onPaired({
          pairId: message.pairId,
          pairSecret: message.pairSecret,
          remoteDevice: message.device
        });
        session.sendJson({
          type: "pair-ack",
          pairId: pairRecord.pairId
        });
        finish(pairRecord);
        return;
      }

      if (message.type === "pair-ack") {
        const pairRecord = await onPaired({
          pairId: pendingPairInit?.pairId || message.pairId,
          pairSecret: pendingPairInit?.pairSecret || "",
          remoteDevice: {
            deviceId: session.remoteDeviceId
          }
        });
        finish(pairRecord);
        session.close();
      }
    };

    const handleClose = () => {
      if (!settled) {
        fail(new Error("Pairing session closed before it finished."));
      }
    };

    session.addEventListener("open", handleOpen);
    session.addEventListener("message", handleMessage);
    session.addEventListener("close", handleClose);
  });
}

export async function runLibrarySyncSession(session, { pairRecord }) {
  const localManifest = await getPaperManifestEntries();
  const requestedFromRemote = new Set();
  const pendingPushAcks = new Set();
  const incomingTransfers = new Map();
  let authSent = false;
  let authVerified = false;
  let remoteManifest = null;
  let manifestSent = false;
  let syncCompleteSent = false;
  let remoteSyncComplete = false;
  let pushedCount = 0;
  let pulledCount = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      session.removeEventListener("open", handleOpen);
      session.removeEventListener("message", handleMessage);
      session.removeEventListener("close", handleClose);
    };

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const maybeSendManifest = async () => {
      if (!authVerified || manifestSent) {
        return;
      }

      manifestSent = true;
      session.sendJson({
        type: "manifest",
        papers: localManifest
      });
      maybeComplete();
    };

    const maybeRequestPapers = () => {
      if (!authVerified || !remoteManifest) {
        return;
      }

      const papersToRequest = remoteManifest.filter((remotePaper) => {
        const localPaper = localManifest.find((entry) => entry.id === remotePaper.id);
        return !localPaper || comparePaperVersions(remotePaper, localPaper) > 0;
      });
      const totalPdfBytes = papersToRequest.reduce(
        (sum, paper) =>
          sum + (paper.contentType === "pdf" ? Number(paper.pdfByteLength || 0) : 0),
        0
      );
      const includePdfAssets = totalPdfBytes <= PDF_INLINE_SYNC_LIMIT_BYTES;

      for (const remotePaper of papersToRequest) {
        if (requestedFromRemote.has(remotePaper.id)) {
          continue;
        }

        requestedFromRemote.add(remotePaper.id);
        session.sendJson({
          type: "request-paper",
          paperId: remotePaper.id,
          includeAssets: includePdfAssets || remotePaper.contentType !== "pdf"
        });
      }

      maybeComplete();
    };

    const maybeComplete = () => {
      if (!authVerified || !manifestSent || !remoteManifest) {
        return;
      }

      if (!syncCompleteSent && requestedFromRemote.size === 0 && pendingPushAcks.size === 0) {
        syncCompleteSent = true;
        session.sendJson({
          type: "sync-complete",
          pulledCount,
          pushedCount
        });
      }

      if (syncCompleteSent && remoteSyncComplete) {
        finish({
          pulledCount,
          pushedCount
        });
        session.close();
      }
    };

    const handleOpen = async () => {
      if (authSent) {
        return;
      }

      authSent = true;
      const nonce = crypto.randomUUID();
      session.sendJson({
        type: "auth",
        pairId: pairRecord.pairId,
        nonce,
        proof: await createProof(pairRecord.pairSecret, nonce)
      });
    };

    const handleMessage = async (event) => {
      const message = event.detail;

      if (message.type === "auth") {
        if (message.pairId !== pairRecord.pairId) {
          fail(new Error("Nearby sync authentication failed."));
          session.close();
          return;
        }

        const expected = await createProof(pairRecord.pairSecret, message.nonce);
        if (expected !== message.proof) {
          fail(new Error("Nearby sync authentication failed."));
          session.close();
          return;
        }

        authVerified = true;
        if (!authSent) {
          authSent = true;
          const nonce = crypto.randomUUID();
          session.sendJson({
            type: "auth",
            pairId: pairRecord.pairId,
            nonce,
            proof: await createProof(pairRecord.pairSecret, nonce)
          });
        }

        await maybeSendManifest();
        return;
      }

      if (message.type === "manifest") {
        remoteManifest = Array.isArray(message.papers) ? message.papers : [];
        maybeRequestPapers();
        return;
      }

      if (message.type === "request-paper") {
        const transfer = await exportPaperTransferPayload(message.paperId, {
          includeAssets: message.includeAssets !== false
        });
        if (message.includeAssets === false && transfer.paper?.contentType === "pdf") {
          transfer.paper = {
            ...transfer.paper,
            pdfFetchStatus: "pending"
          };
        }
        const serialized = JSON.stringify(transfer);
        const chunks = splitIntoChunks(serialized, CHUNK_SIZE);
        const transferId = crypto.randomUUID();

        pendingPushAcks.add(transferId);
        session.sendJson({
          type: "paper-transfer-start",
          transferId,
          paperId: message.paperId,
          totalChunks: chunks.length
        });

        for (let index = 0; index < chunks.length; index += 1) {
          session.sendJson({
            type: "paper-transfer-chunk",
            transferId,
            index,
            data: chunks[index]
          });
        }

        session.sendJson({
          type: "paper-transfer-complete",
          transferId
        });
        return;
      }

      if (message.type === "paper-transfer-start") {
        incomingTransfers.set(message.transferId, {
          paperId: message.paperId,
          totalChunks: Number(message.totalChunks || 0),
          chunks: []
        });
        return;
      }

      if (message.type === "paper-transfer-chunk") {
        const transfer = incomingTransfers.get(message.transferId);
        if (!transfer) {
          return;
        }

        transfer.chunks[message.index] = String(message.data || "");
        return;
      }

      if (message.type === "paper-transfer-complete") {
        const transfer = incomingTransfers.get(message.transferId);
        if (!transfer) {
          return;
        }

        incomingTransfers.delete(message.transferId);
        if (transfer.chunks.filter(Boolean).length !== transfer.totalChunks) {
          requestedFromRemote.delete(transfer.paperId);
          maybeComplete();
          return;
        }

        const payload = JSON.parse(transfer.chunks.join(""));
        const changed = await importPaperTransferPayload(payload);
        requestedFromRemote.delete(transfer.paperId);
        if (changed) {
          pulledCount += 1;
        }

        session.sendJson({
          type: "ack",
          transferId: message.transferId
        });
        maybeComplete();
        return;
      }

      if (message.type === "ack") {
        if (pendingPushAcks.delete(message.transferId)) {
          pushedCount += 1;
        }
        maybeComplete();
        return;
      }

      if (message.type === "sync-complete") {
        remoteSyncComplete = true;
        maybeComplete();
      }
    };

    const handleClose = () => {
      if (!settled) {
        fail(new Error("Nearby sync session closed."));
      }
    };

    session.addEventListener("open", handleOpen);
    session.addEventListener("message", handleMessage);
    session.addEventListener("close", handleClose);
  });
}

async function createPairSecret() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  return `${crypto.randomUUID()}.${bytesToHex(randomBytes)}`;
}

async function buildPairId(leftDeviceId, rightDeviceId) {
  const data = [leftDeviceId, rightDeviceId].sort().join("::");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(digest));
}

async function createProof(secret, nonce) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce));
  return bytesToHex(new Uint8Array(signature));
}

function splitIntoChunks(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
