import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';
let modelsPromise: Promise<void> | null = null;

export const loadFaceApiModels = async (): Promise<void> => {
  if (modelsPromise) return modelsPromise;

  modelsPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]).then(() => undefined);

  try {
    await modelsPromise;
  } catch (error) {
    modelsPromise = null;
    throw error;
  }
};

export const detectSingleFaceDescriptor = (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) =>
  faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
