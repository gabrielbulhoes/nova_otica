/**
 * Interface do rastreador facial. A implementação real (MediaPipe
 * FaceLandmarker / Jeeliz) entra no spike AR-2, sem alterar a UI: basta trocar
 * a implementação por trás desta interface. O placeholder abaixo devolve uma
 * caixa central fixa para a experiência funcionar ponta a ponta enquanto o
 * pipeline de encaixe 3D preciso não é integrado.
 */
export interface FaceBox {
  /** Centro X normalizado (0..1). */
  cx: number;
  /** Centro Y normalizado (0..1). */
  cy: number;
  /** Largura do rosto normalizada (0..1) — usada para escalar a armação. */
  width: number;
  /** Rotação (roll) em graus. */
  roll: number;
}

export interface FaceTracker {
  readonly name: string;
  start(video: HTMLVideoElement): Promise<void>;
  detect(): FaceBox | null;
  stop(): void;
}

/** Placeholder — caixa central fixa. Substituir por MediaPipe no spike AR-2. */
export class CenteredTracker implements FaceTracker {
  readonly name = 'centered-placeholder';
  async start(_video: HTMLVideoElement): Promise<void> {
    /* nada a inicializar no placeholder */
  }
  detect(): FaceBox {
    return { cx: 0.5, cy: 0.4, width: 0.42, roll: 0 };
  }
  stop(): void {
    /* nada a liberar */
  }
}
