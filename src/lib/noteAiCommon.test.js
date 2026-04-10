import { describe, expect, it } from "vitest";
import {
  createNoteMathAppConfig,
  getNoteMathModelLibUrl,
  getNoteMathModelUrl,
  getNoteSpeechModelPath,
  isNoteAiRemoteFootprintSafe,
  parseMathInterpretation
} from "./noteAiCommon";

describe("noteAiCommon", () => {
  it("builds model URLs from a configured root", () => {
    const root = "https://cdn.example/models/note-ai";

    expect(getNoteSpeechModelPath(root)).toBe("https://cdn.example/models/note-ai/whisper-base");
    expect(getNoteMathModelUrl(root)).toBe(
      "https://cdn.example/models/note-ai/DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC"
    );
    expect(getNoteMathModelLibUrl(root)).toBe(
      "https://cdn.example/models/note-ai/webllm/Qwen2-1.5B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm"
    );
    expect(createNoteMathAppConfig(root)).toEqual({
      useIndexedDBCache: true,
      model_list: [
        expect.objectContaining({
          model:
            "https://cdn.example/models/note-ai/DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC",
          model_id: "DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC"
        })
      ]
    });
  });

  it("parses JSON math responses and strips thinking tags", () => {
    const parsed = parseMathInterpretation(
      '<think>hidden</think>{"latex":"\\\\int_0^1 x^2 \\\\; dx","spokenText":"integral from zero to one of x squared d x"}'
    );

    expect(parsed).toEqual({
      mathLatex: "\\int_0^1 x^2 \\; dx",
      spokenText: "integral from zero to one of x squared d x",
      rawText:
        '{"latex":"\\\\int_0^1 x^2 \\\\; dx","spokenText":"integral from zero to one of x squared d x"}'
    });
  });

  it("does not misclassify plain prose as latex", () => {
    expect(parseMathInterpretation("There was no mathematical content here.")).toEqual({
      mathLatex: "",
      spokenText: "",
      rawText: "There was no mathematical content here."
    });
  });

  it("keeps the mirrored model set below ten gibibytes", () => {
    expect(isNoteAiRemoteFootprintSafe()).toBe(true);
  });
});
