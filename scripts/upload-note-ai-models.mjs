#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

const MAX_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024;
const SPEECH_MODEL_ID = "Xenova/whisper-base";
const MATH_MODEL_ID = "mlc-ai/DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC";
const WEBLLM_MODEL_VERSION = "v0_2_80";
const WEBLLM_MODEL_LIB =
  "Qwen2-1.5B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm";

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) {
  console.error("Usage: node scripts/upload-note-ai-models.mjs <bucket-name> [prefix]");
  process.exit(1);
}

const bucketName = args[0];
const prefix = String(args[1] || "models/note-ai").replace(/^\/+|\/+$/g, "");

const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ar5iv-note-ai-"));

try {
  const manifest = await buildManifest(prefix);
  const totalBytes = manifest.reduce((sum, asset) => sum + Number(asset.size || 0), 0);

  if (totalBytes > MAX_FREE_TIER_BYTES) {
    throw new Error(
      `Selected note AI assets total ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB, which exceeds the 10 GiB limit.`
    );
  }

  console.log(
    `Uploading ${manifest.length} assets (${formatBytes(totalBytes)}) to r2://${bucketName}/${prefix}`
  );

  for (const [index, asset] of manifest.entries()) {
    const localFile = path.join(tempDirectory, sanitizeFilename(asset.key));
    console.log(
      `[${index + 1}/${manifest.length}] ${asset.key} <- ${asset.sourceUrl} (${formatBytes(asset.size)})`
    );
    await downloadToFile(asset.sourceUrl, localFile);
    await uploadToR2(bucketName, asset.key, localFile, asset.contentType);
    await fs.unlink(localFile);
  }

  console.log("Note AI model upload complete.");
} finally {
  await fs.rm(tempDirectory, {
    recursive: true,
    force: true
  });
}

async function buildManifest(prefixPath) {
  const speechFiles = await fetchTree(SPEECH_MODEL_ID, "main");
  const mathFiles = await fetchTree(MATH_MODEL_ID, "main");
  const webllmModelLib = await buildWebLlmModelLibAsset(prefixPath);

  const speechManifest = speechFiles
    .filter((file) =>
      [
        "config.json",
        "generation_config.json",
        "merges.txt",
        "normalizer.json",
        "preprocessor_config.json",
        "quant_config.json",
        "quantize_config.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "vocab.json",
        "onnx/encoder_model_q4.onnx",
        "onnx/decoder_model_merged_q4.onnx",
        "onnx/decoder_with_past_model_q4.onnx"
      ].includes(file.path)
    )
    .map((file) => ({
      key: `${prefixPath}/whisper-base/${file.path}`,
      sourceUrl: resolveHuggingFaceFileUrl(SPEECH_MODEL_ID, file.path),
      size: Number(file.size || 0),
      contentType: guessContentType(file.path)
    }));

  const mathManifest = mathFiles
    .filter((file) => ![".gitattributes", "README.md", "ndarray-cache-b16.json"].includes(file.path))
    .map((file) => ({
      key: `${prefixPath}/DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC/${file.path}`,
      sourceUrl: resolveHuggingFaceFileUrl(MATH_MODEL_ID, file.path),
      size: Number(file.size || 0),
      contentType: guessContentType(file.path)
    }));

  return [...speechManifest, ...mathManifest, webllmModelLib];
}

async function buildWebLlmModelLibAsset(prefixPath) {
  const sourceUrl =
    `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/` +
    `${WEBLLM_MODEL_VERSION}/${WEBLLM_MODEL_LIB}`;
  const headResponse = await fetch(sourceUrl, {
    method: "HEAD"
  });
  if (!headResponse.ok) {
    throw new Error(`Failed to inspect ${sourceUrl}: ${headResponse.status}`);
  }

  return {
    key: `${prefixPath}/webllm/${WEBLLM_MODEL_LIB}`,
    sourceUrl,
    size: Number(headResponse.headers.get("content-length") || 0),
    contentType: "application/wasm"
  };
}

async function fetchTree(modelId, revision) {
  const response = await fetch(
    `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=1`
  );
  if (!response.ok) {
    throw new Error(`Failed to inspect ${modelId}: ${response.status}`);
  }

  return response.json();
}

function resolveHuggingFaceFileUrl(modelId, filePath) {
  return `https://huggingface.co/${modelId}/resolve/main/${filePath}?download=true`;
}

function guessContentType(filePath) {
  if (filePath.endsWith(".json")) {
    return "application/json";
  }
  if (filePath.endsWith(".onnx") || filePath.endsWith(".bin")) {
    return "application/octet-stream";
  }
  if (filePath.endsWith(".wasm")) {
    return "application/wasm";
  }
  if (filePath.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

async function downloadToFile(sourceUrl, outputPath) {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${sourceUrl}: ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body), (await import("node:fs")).createWriteStream(outputPath));
}

async function uploadToR2(bucketName, key, localFile, contentType) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "bunx",
      [
        "wrangler@4.73.0",
        "r2",
        "object",
        "put",
        `${bucketName}/${key}`,
        "--remote",
        "--file",
        localFile,
        "--content-type",
        contentType
      ],
      {
        stdio: "inherit"
      }
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`wrangler r2 object put failed for ${key} with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function sanitizeFilename(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}
