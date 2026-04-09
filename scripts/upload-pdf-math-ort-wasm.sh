#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <bucket-name> [object-key]" >&2
  exit 1
fi

bucket_name="$1"
object_key="${2:-vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm}"
source_file="node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm"

if [[ ! -f "$source_file" ]]; then
  echo "Missing $source_file. Run 'bun install' first." >&2
  exit 1
fi

bunx wrangler@4.73.0 r2 object put "${bucket_name}/${object_key}" \
  --remote \
  --file "$source_file" \
  --content-type "application/wasm"

echo "Uploaded ${source_file} to r2://${bucket_name}/${object_key}"
