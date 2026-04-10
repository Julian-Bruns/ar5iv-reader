const TARGET_SAMPLE_RATE = 16_000;

export async function startNoteSpeechRecorder() {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder !== "function"
  ) {
    throw new Error("Microphone recording is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
  const mimeType = pickSupportedMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start();

  return {
    async stop() {
      if (recorder.state !== "inactive") {
        await waitForRecorderStop(recorder);
      }

      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm"
      });
      stopStream(stream);
      return decodeNoteSpeechBlob(blob);
    },
    cancel() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      stopStream(stream);
    }
  };
}

export async function decodeNoteSpeechBlob(blob) {
  const AudioContextConstructor =
    globalThis.AudioContext || globalThis.webkitAudioContext || null;
  if (!AudioContextConstructor) {
    throw new Error("Audio decoding is not supported in this browser.");
  }

  const audioContext = new AudioContextConstructor();

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mixed = mixToMono(audioBuffer);
    const samples =
      audioBuffer.sampleRate === TARGET_SAMPLE_RATE
        ? mixed
        : resamplePcm(mixed, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

    return {
      blob,
      sampleRate: TARGET_SAMPLE_RATE,
      samples
    };
  } finally {
    if (typeof audioContext.close === "function") {
      await audioContext.close().catch(() => {});
    }
  }
}

function pickSupportedMimeType() {
  if (typeof MediaRecorder?.isTypeSupported !== "function") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];

  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

function waitForRecorderStop(recorder) {
  return new Promise((resolve, reject) => {
    const handleStop = () => {
      recorder.removeEventListener("stop", handleStop);
      recorder.removeEventListener("error", handleError);
      resolve();
    };
    const handleError = (event) => {
      recorder.removeEventListener("stop", handleStop);
      recorder.removeEventListener("error", handleError);
      reject(event?.error || new Error("Microphone recording failed."));
    };

    recorder.addEventListener("stop", handleStop);
    recorder.addEventListener("error", handleError);
    recorder.stop();
  });
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function mixToMono(audioBuffer) {
  const channelCount = Number(audioBuffer?.numberOfChannels || 0);
  const frameCount = Number(audioBuffer?.length || 0);
  if (channelCount <= 1) {
    return audioBuffer.getChannelData(0).slice();
  }

  const mixed = new Float32Array(frameCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      mixed[frameIndex] += channel[frameIndex] / channelCount;
    }
  }
  return mixed;
}

function resamplePcm(samples, inputRate, outputRate) {
  if (!samples?.length || inputRate <= 0 || outputRate <= 0 || inputRate === outputRate) {
    return samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const weight = sourceIndex - leftIndex;
    output[index] = samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
  }

  return output;
}
