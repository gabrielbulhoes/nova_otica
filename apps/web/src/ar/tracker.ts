/**
 * Interface do rastreador facial. A implementação real é a `MediaPipeTracker`
 * (FaceLandmarker); a `CenteredTracker` é um fallback quando a MediaPipe não
 * carrega (offline/sem suporte). Trocar a implementação não afeta a UI.
 */
export interface FaceBox {
  /** Centro X normalizado (0..1) — coordenadas nativas do vídeo. */
  cx: number;
  /** Centro Y normalizado (0..1). */
  cy: number;
  /** Largura da armação normalizada (0..1) — ~2.1× a distância interpupilar. */
  width: number;
  /** Rotação em torno do eixo de visão (roll), em graus. */
  roll: number;
}

export interface FaceResult {
  box: FaceBox;
  /** Landmarks normalizados (quando disponíveis). */
  landmarks?: { x: number; y: number; z: number }[];
  /** Matriz de transformação facial 4×4 (column-major, 16 números). */
  matrix?: number[];
}

export interface FaceTracker {
  readonly name: string;
  start(video: HTMLVideoElement): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): FaceResult | null;
  stop(): void;
}

/** Fallback — caixa central fixa (sem rastreamento real). */
export class CenteredTracker implements FaceTracker {
  readonly name = 'centered-fallback';
  async start(_video: HTMLVideoElement): Promise<void> {
    /* nada a inicializar */
  }
  detect(_video: HTMLVideoElement, _timestampMs: number): FaceResult {
    return { box: { cx: 0.5, cy: 0.4, width: 0.42, roll: 0 } };
  }
  stop(): void {
    /* nada a liberar */
  }
}

/** Deriva a caixa da armação a partir dos landmarks (cantos externos dos olhos). */
export function deriveBoxFromLandmarks(lm: { x: number; y: number; z: number }[]): FaceBox {
  // Índices do FaceLandmarker: 33 = canto externo do olho direito,
  // 263 = canto externo do olho esquerdo.
  const right = lm[33];
  const left = lm[263];
  const cx = (right.x + left.x) / 2;
  const cy = (right.y + left.y) / 2;
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const eyeDist = Math.hypot(dx, dy);
  return {
    cx,
    cy,
    width: Math.min(eyeDist * 2.1, 0.95),
    roll: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}
