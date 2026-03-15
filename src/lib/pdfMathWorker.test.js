import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(testDir, "./pdfMathWorker.js");

describe("pdfMathWorker protocol contract", () => {
  it("handles the frozen request types", () => {
    const source = fs.readFileSync(workerPath, "utf8");

    expect(source).toMatch(/if \(type === "INIT"\)/);
    expect(source).toMatch(/if \(type === "LOAD_MODELS"\)/);
    expect(source).toMatch(/if \(type === "RUN_BENCHMARK"\)/);
    expect(source).toMatch(/if \(type === "DETECT_AND_RECOGNIZE"\)/);
    expect(source).toMatch(/if \(type === "DISPOSE"\)/);
  });

  it("emits the frozen response message shapes", () => {
    const source = fs.readFileSync(workerPath, "utf8");

    expect(source).toMatch(/type:\s*"READY"[\s\S]*requestId[\s\S]*stage:\s*"init"/);
    expect(source).toMatch(/type:\s*"PROGRESS"[\s\S]*stage:\s*progress\.stage/);
    expect(source).toMatch(/type:\s*"PROGRESS"[\s\S]*modelId:\s*progress\.modelId/);
    expect(source).toMatch(/type:\s*"PROGRESS"[\s\S]*loadedBytes:\s*Number\(progress\.loadedBytes \|\| 0\)/);
    expect(source).toMatch(/type:\s*"PROGRESS"[\s\S]*totalBytes:/);
    expect(source).toMatch(/type:\s*"READY"[\s\S]*requestId[\s\S]*stage:\s*"models"/);
    expect(source).toMatch(/type:\s*"BENCHMARK_RESULT"[\s\S]*durationMs[\s\S]*passed[\s\S]*thresholdMs/);
    expect(source).toMatch(/type:\s*"RESULT"[\s\S]*payload:\s*createPdfMathResult\(result\)/);
    expect(source).toMatch(/type:\s*"ERROR"[\s\S]*code:\s*normalized\.code[\s\S]*message:\s*normalized\.message[\s\S]*fatal:\s*Boolean\(normalized\.fatal\)/);
  });

  it("creates the runtime through the dedicated pdf math runtime module", () => {
    const source = fs.readFileSync(workerPath, "utf8");

    expect(source).toMatch(/import \{ createPdfMathRuntime \} from "\.\/pdfMathRuntime";/);
    expect(source).toMatch(/return createPdfMathRuntime\(\{/);
    expect(source).toMatch(/modelRevision: PDF_MATH_MODEL_REVISION/);
  });
});
