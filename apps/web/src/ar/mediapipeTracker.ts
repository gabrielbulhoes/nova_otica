import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { deriveBoxFromLandmarks, type FaceResult, type FaceTracker } from './tracker';

// Carregados no dispositivo do usuário em runtime (não neste build).
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Rastreador facial real via MediaPipe FaceLandmarker (478 pontos + matriz de
 * transformação facial). Processa os quadros do vídeo no dispositivo — nenhuma
 * imagem sai do aparelho.
 */
export class MediaPipeTracker implements FaceTracker {
  readonly name = 'mediapipe-facelandmarker';
  private landmarker: FaceLandmarker | null = null;
  private lastTs = -1;

  async start(_video: HTMLVideoElement): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceResult | null {
    if (!this.landmarker || video.readyState < 2) return null;
    // detectForVideo exige timestamps estritamente crescentes.
    const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs;
    this.lastTs = ts;

    const res: FaceLandmarkerResult = this.landmarker.detectForVideo(video, ts);
    const landmarks = res.faceLandmarks?.[0];
    if (!landmarks || landmarks.length === 0) return null;

    const matrix = res.facialTransformationMatrixes?.[0]?.data;
    return {
      box: deriveBoxFromLandmarks(landmarks),
      landmarks,
      matrix: matrix ? Array.from(matrix) : undefined,
    };
  }

  stop(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTs = -1;
  }
}
