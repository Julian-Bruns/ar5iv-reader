import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import preact from "@preact/preset-vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPdfMathOrtWasmUrl =
  "https://pub-204df3f8d4a445cdbda23b55ffae9214.r2.dev/vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm";
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
);
const appVersion = String(packageJson.version || "0.0.0");
const buildId = sanitizeBuildId(
  process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    appVersion ||
    new Date().toISOString()
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const externalOrtWasmUrl = normalizeExternalAssetUrl(env.VITE_PDF_MATH_ORT_WASM_URL)
    || defaultPdfMathOrtWasmUrl;
  const noteAiModelRootUrl = normalizeModelRootUrl(env.VITE_NOTE_AI_MODEL_ROOT_URL);

  return {
    plugins: [
      preact(),
      generatedServiceWorkerPlugin({
        buildId,
        publicDir: path.join(projectRoot, "public"),
        templatePath: path.join(projectRoot, "src", "sw.js")
      }),
      externalOrtWasmPlugin({
        externalOrtWasmUrl
      })
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_ID__: JSON.stringify(buildId),
      __PDF_MATH_ORT_WASM_URL__: JSON.stringify(externalOrtWasmUrl),
      __NOTE_AI_MODEL_ROOT_URL__: JSON.stringify(noteAiModelRootUrl)
    },
    server: {
      port: 5173
    }
  };
});

function generatedServiceWorkerPlugin({ buildId, publicDir, templatePath }) {
  return {
    name: "generated-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const precacheUrls = new Set(["/", "/index.html"]);
      for (const assetPath of listPublicAssets(publicDir)) {
        precacheUrls.add(assetPath);
      }

      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName === "sw.js") {
          continue;
        }

        if (fileName.endsWith(".wasm")) {
          continue;
        }

        if (output.type === "asset" || output.type === "chunk") {
          precacheUrls.add(`/${fileName}`);
        }
      }

      const source = fs.readFileSync(templatePath, "utf8");
      const rendered = source
        .replace(/__APP_BUILD_ID__/g, buildId)
        .replace("__PRECACHE_URLS__", JSON.stringify([...precacheUrls].sort(), null, 2));

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: rendered
      });
    }
  };
}

function externalOrtWasmPlugin({ externalOrtWasmUrl }) {
  return {
    name: "external-ort-wasm",
    apply: "build",
    generateBundle(_options, bundle) {
      if (!externalOrtWasmUrl) {
        return;
      }

      for (const fileName of Object.keys(bundle)) {
        if (/(^|\/)ort-wasm-simd-threaded.*\.wasm$/i.test(fileName)) {
          delete bundle[fileName];
        }
      }
    }
  };
}

function listPublicAssets(publicDir) {
  if (!fs.existsSync(publicDir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
    walkPublicEntry(publicDir, entry, files);
  }
  return files;
}

function walkPublicEntry(baseDir, entry, files, parentPath = "") {
  const relativePath = path.posix.join(parentPath, entry.name);
  const absolutePath = path.join(baseDir, relativePath);

  if (entry.isDirectory()) {
    for (const child of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      walkPublicEntry(baseDir, child, files, relativePath);
    }
    return;
  }

  if (
    relativePath === "sw.js" ||
    relativePath === "_redirects" ||
    relativePath.startsWith("models/")
  ) {
    return;
  }

  files.push(`/${relativePath}`);
}

function sanitizeBuildId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "dev-build";
}

function normalizeExternalAssetUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeModelRootUrl(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue.startsWith("/")) {
    return normalizedValue.replace(/\/+$/g, "");
  }

  return normalizeExternalAssetUrl(normalizedValue).replace(/\/+$/g, "");
}
