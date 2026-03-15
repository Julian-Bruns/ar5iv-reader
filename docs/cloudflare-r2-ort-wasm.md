# Cloudflare Pages + R2 ORT WASM Setup

This app only needs R2 for one file that exceeds Cloudflare Pages' 25 MiB per-file limit:

- `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm`

The PDF model files stay on their existing fetch path. That keeps R2 request volume to one cold request per browser/device for the ONNX runtime instead of moving the whole PDF math asset set to R2.

## One-time bucket setup

1. Create an R2 bucket in the same Cloudflare account as your Pages project.
2. Make the bucket publicly readable.
3. Prefer a custom domain such as `assets.example.com`.
   Cloudflare's `r2.dev` URL is for development and is rate-limited.
4. Configure bucket CORS so your Pages origin can fetch the wasm file from the browser.

Example CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://your-project.pages.dev",
      "https://your-custom-domain.example"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "Content-Length",
      "Content-Type",
      "ETag"
    ],
    "MaxAgeSeconds": 86400
  }
]
```

Apply it with Wrangler:

```bash
npx wrangler r2 bucket cors set <BUCKET_NAME> --file cors.json
```

## Upload the wasm object

Use the helper script from the repo root:

```bash
bun run cf:r2:upload:ort-wasm -- <BUCKET_NAME>
```

The helper uses Wrangler's `--remote` mode so the object is uploaded to the real R2 bucket, not local development storage.

Or provide your own object key:

```bash
bun run cf:r2:upload:ort-wasm -- <BUCKET_NAME> vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm
```

## Configure Cloudflare Pages

Set this environment variable in your Pages project:

```bash
VITE_PDF_MATH_ORT_WASM_URL=https://assets.example.com/vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm
```

Once that variable is set during the build:

- the app configures ONNX Runtime Web to load the wasm file from that URL
- the local `ort-wasm-*.wasm` asset is removed from the Pages build output
- the Pages deploy no longer contains a file over 25 MiB

## Local verification

Build with a placeholder external URL:

```bash
VITE_PDF_MATH_ORT_WASM_URL=https://assets.example.com/vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm bun run build
```

Then confirm the large wasm file is gone:

```bash
find dist -name '*.wasm'
```

That command should print nothing for the production Pages build when the variable is set.
