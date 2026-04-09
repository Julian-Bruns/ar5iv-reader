const BYTE_DECODER = buildByteDecoder();
const TEXT_DECODER = new TextDecoder();
const SPECIAL_TOKEN_IDS = new Set([0, 1, 2, 3, 4]);

export function createPdfMathTokenizer(tokenizerJson) {
  const vocab = tokenizerJson?.model?.vocab;
  if (!vocab || typeof vocab !== "object") {
    throw new Error("PDF math tokenizer vocabulary is invalid.");
  }

  const maxId = Math.max(...Object.values(vocab).map((value) => Number(value)));
  const idToToken = new Array(maxId + 1).fill("");
  for (const [token, tokenId] of Object.entries(vocab)) {
    idToToken[Number(tokenId)] = token;
  }

  return Object.freeze({
    decode(tokenIds, { skipSpecialTokens = true } = {}) {
      const pieces = [];
      for (const rawId of tokenIds) {
        const tokenId = Number(rawId);
        if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= idToToken.length) {
          continue;
        }

        if (skipSpecialTokens && SPECIAL_TOKEN_IDS.has(tokenId)) {
          continue;
        }

        const token = idToToken[tokenId];
        if (!token) {
          continue;
        }

        pieces.push(token);
      }

      return decodeByteLevel(pieces);
    }
  });
}

function decodeByteLevel(tokens) {
  const bytes = [];
  const joined = tokens.join("");

  for (const character of joined) {
    const decodedByte = BYTE_DECODER.get(character);
    if (decodedByte == null) {
      const encoded = new TextEncoder().encode(character);
      for (const value of encoded) {
        bytes.push(value);
      }
      continue;
    }

    bytes.push(decodedByte);
  }

  return TEXT_DECODER.decode(new Uint8Array(bytes));
}

function buildByteDecoder() {
  const bytes = [];
  const chars = [];

  appendRange(bytes, 33, 126);
  appendRange(bytes, 161, 172);
  appendRange(bytes, 174, 255);
  appendRange(chars, 33, 126);
  appendRange(chars, 161, 172);
  appendRange(chars, 174, 255);

  let extra = 0;
  for (let value = 0; value < 256; value += 1) {
    if (bytes.includes(value)) {
      continue;
    }

    bytes.push(value);
    chars.push(256 + extra);
    extra += 1;
  }

  const decoder = new Map();
  for (let index = 0; index < bytes.length; index += 1) {
    decoder.set(String.fromCodePoint(chars[index]), bytes[index]);
  }
  return decoder;
}

function appendRange(target, start, end) {
  for (let value = start; value <= end; value += 1) {
    target.push(value);
  }
}

