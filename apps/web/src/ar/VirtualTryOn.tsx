import { useEffect, useRef, useState } from 'react';
import { getArAsset, recordTryOn, type ArAsset } from '../api/client';
import type { FaceBox, FaceTracker } from './tracker';
import type { GlassesRenderer } from './glassesRenderer';

type Step = 'consent' | 'starting' | 'live' | 'error';
type Mode = 'mediapipe' | 'placeholder';

/**
 * Provador virtual (AR). Câmera on-device + consentimento LGPD + telemetria.
 * Encaixe real com MediaPipe FaceLandmarker + Three.js (carregados sob demanda);
 * se a MediaPipe não estiver disponível, cai para uma prévia central 2D.
 */
export function VirtualTryOn({
  productId,
  storeId,
  onClose,
  onAddToCart,
}: {
  productId: string;
  storeId?: string;
  onClose: () => void;
  onAddToCart?: () => void;
}) {
  const [step, setStep] = useState<Step>('consent');
  const [mode, setMode] = useState<Mode>('mediapipe');
  const [asset, setAsset] = useState<ArAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<FaceBox | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const rendererRef = useRef<GlassesRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const startedAt = useRef(0);
  const converted = useRef(false);

  useEffect(() => {
    getArAsset(productId).then(setAsset).catch(() => setAsset(null));
  }, [productId]);

  useEffect(() => {
    startedAt.current = Date.now();
    return () => {
      cancelAnimationFrame(rafRef.current);
      rendererRef.current?.dispose();
      trackerRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const durationMs = Date.now() - startedAt.current;
      recordTryOn({ productId, storeId, durationMs, converted: converted.current }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setStep('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setStep('live');
      await initTracking(video);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível acessar a câmera.');
      setStep('error');
    }
  }

  async function initTracking(video: HTMLVideoElement) {
    try {
      const [{ MediaPipeTracker }, { GlassesRenderer }] = await Promise.all([
        import('./mediapipeTracker'),
        import('./glassesRenderer'),
      ]);
      const tracker = new MediaPipeTracker();
      await tracker.start(video);
      trackerRef.current = tracker;

      const canvas = canvasRef.current!;
      const renderer = new GlassesRenderer(canvas);
      renderer.resize(canvas.clientWidth || 480, canvas.clientHeight || 360);
      await renderer.loadModel(asset?.url, asset?.type);
      rendererRef.current = renderer;
      setMode('mediapipe');

      const loop = () => {
        const result = trackerRef.current?.detect(video, performance.now());
        if (result) rendererRef.current?.update(result);
        else rendererRef.current?.clear();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      // MediaPipe indisponível (offline/sem suporte) → prévia 2D central.
      const { CenteredTracker } = await import('./tracker');
      trackerRef.current = new CenteredTracker();
      setMode('placeholder');
      setBox(trackerRef.current.detect(video, 0)!.box);
    }
  }

  const addToCart = () => {
    converted.current = true;
    onAddToCart?.();
  };

  const overlayStyle: React.CSSProperties | undefined =
    mode === 'placeholder' && box
      ? {
          position: 'absolute',
          left: `${box.cx * 100}%`,
          top: `${box.cy * 100}%`,
          width: `${box.width * 100}%`,
          transform: `translate(-50%, -50%) rotate(${box.roll}deg)`,
          pointerEvents: 'none',
        }
      : undefined;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            Provar {asset ? `— ${asset.product.description}` : ''}
          </h3>
          <button className="btn ghost sm" onClick={onClose}>
            Fechar
          </button>
        </div>

        {step === 'consent' && (
          <div>
            <p className="muted">
              Vamos usar a câmera para você provar a armação. O processamento é feito{' '}
              <strong>no seu aparelho</strong> (MediaPipe): nenhuma imagem do seu rosto é enviada ou
              armazenada. Guardamos apenas um registro anônimo da prova (produto e duração).
            </p>
            <div className="row-between">
              <button className="btn ghost" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn" onClick={startCamera}>
                Permitir câmera e provar
              </button>
            </div>
          </div>
        )}

        {step === 'starting' && <div className="empty">Iniciando a câmera e o rastreamento…</div>}

        {step === 'error' && (
          <div>
            <div className="badge red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>
              {error}
            </div>
            <button className="btn ghost" onClick={onClose}>
              Fechar
            </button>
          </div>
        )}

        {step === 'live' && (
          <div>
            <div
              style={{
                position: 'relative',
                borderRadius: 12,
                overflow: 'hidden',
                background: '#000',
                aspectRatio: '4 / 3',
                transform: 'scaleX(-1)', // espelho (selfie): vídeo + overlay juntos
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  display: mode === 'mediapipe' ? 'block' : 'none',
                }}
              />
              {overlayStyle && <GlassesOverlay style={overlayStyle} />}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {mode === 'mediapipe'
                ? `Encaixe 3D em tempo real (MediaPipe + Three.js${asset?.type === 'GLB_3D' ? ' · modelo 3D' : ''}). Ajuste fino de escala requer calibração/QA em dispositivo.`
                : 'Prévia 2D central (MediaPipe indisponível neste dispositivo).'}
            </p>
            <div className="row-between" style={{ marginTop: 8 }}>
              <button className="btn ghost" onClick={onClose}>
                Sair
              </button>
              {onAddToCart && (
                <button className="btn" onClick={addToCart}>
                  Gostei — adicionar ao carrinho
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sobreposição vetorial simples (fallback 2D). */
function GlassesOverlay({ style }: { style: React.CSSProperties }) {
  return (
    <svg style={style} viewBox="0 0 200 70" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#0f1729" strokeWidth="5" fill="rgba(20,30,60,0.28)">
        <rect x="6" y="14" width="78" height="46" rx="16" />
        <rect x="116" y="14" width="78" height="46" rx="16" />
        <path d="M84 30 q16 -10 32 0" fill="none" />
      </g>
    </svg>
  );
}
