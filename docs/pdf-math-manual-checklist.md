# PDF Math Manual Checklist

1. Open a PDF fallback paper on a supported HTTPS page in a WebGPU-capable browser.
2. Confirm the PDF status reaches `Click an equation to copy LaTeX.` after initial preparation.
3. Reload the same paper and confirm the app reuses cached model files instead of re-downloading unchanged assets.
4. Click a clear formula and confirm the app shows `Copied!` and places the expected LaTeX on the clipboard.
5. Click a non-formula region and confirm the surface shows `No formula was detected at that location.` without showing an extra toast.
6. Force a PDF render failure and confirm the surface shows `PDF failed to load.`
