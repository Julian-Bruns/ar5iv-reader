import { PDF_MATH_MODEL_REVISION } from "./pdfMathCommon";

const SAME_ORIGIN_ROOT = `/models/${PDF_MATH_MODEL_REVISION}`;

const PDF_MATH_MODEL_MANIFEST = Object.freeze({
  revision: PDF_MATH_MODEL_REVISION,
  models: Object.freeze({
    "breezedeus/pix2text-mfd": Object.freeze({
      role: "detector",
      modelId: "breezedeus/pix2text-mfd",
      directory: "pix2text-mfd",
      files: Object.freeze([
        createModelFileDescriptor("pix2text-mfd", "breezedeus/pix2text-mfd", "config.yaml", 23, "2768256f4e0ae82e1e0b4e0844c19be37b5875a5794ce63051bd999a32288df7"),
        createModelFileDescriptor("pix2text-mfd", "breezedeus/pix2text-mfd", "mfd-v20240618.onnx", 44_573_224, "51a8854743b17ae654729af8db82a630c1ccfa06debf4856c8b28055f87d02c1")
      ])
    }),
    "breezedeus/pix2text-mfr": Object.freeze({
      role: "recognizer",
      modelId: "breezedeus/pix2text-mfr",
      directory: "pix2text-mfr",
      files: Object.freeze([
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "config.json", 4_556, "9f3812441d397c871b9b2a74e8d956b939aec5f4f45745bba9214e968d56449d"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "decoder_model.onnx", 30_114_937, "fd0f92d7a012f3dae41e1ac79421aea0ea888b5a66cb3f9a004e424f82f3daed"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "encoder_model.onnx", 87_496_990, "bd8d5c322792e9ec45793af5569e9748f82a3d728a9e00213dbfc56c1486f37d"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "generation_config.json", 210, "cbea88288d5576a9655ad04e2456768544be22273a1c5ca160e0d16384639b4f"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "preprocessor_config.json", 450, "36a945a7cc645688b9ef64dabae16979cf5f7c1c448569cc306694edc0598b9b"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "special_tokens_map.json", 964, "8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "tokenizer.json", 39_161, "3e2ab757277d22639bec28c9d7972e352d3d1dba223051fa674002dc5ab64df3"),
        createModelFileDescriptor("pix2text-mfr", "breezedeus/pix2text-mfr", "tokenizer_config.json", 1_181, "7ffff31747c73b1a462b766abfc128e03f669e5b8452fe6e175b1430a078ac8d")
      ])
    })
  })
});

export function getPdfMathModelManifest(revision = PDF_MATH_MODEL_REVISION) {
  if (revision !== PDF_MATH_MODEL_MANIFEST.revision) {
    return null;
  }

  return PDF_MATH_MODEL_MANIFEST;
}

export function getPdfMathModelEntry(modelId, revision = PDF_MATH_MODEL_REVISION) {
  const manifest = getPdfMathModelManifest(revision);
  return manifest?.models?.[modelId] || null;
}

function createModelFileDescriptor(directory, modelId, filename, size, sha256) {
  return Object.freeze({
    filename,
    size,
    sha256,
    sameOriginUrl: `${SAME_ORIGIN_ROOT}/${directory}/${filename}`,
    remoteUrl: `https://huggingface.co/${modelId}/resolve/main/${filename}?download=true`
  });
}

