import { useEffect, useRef, useState } from 'react';
import { getArAsset, recordTryOn, type ArAsset } from '../api/client';
import { CenteredTracker, type FaceBox } from './tracker';

type Step = 'consent' | 'starting' | 'live' | 'error';

/**
 * Provador virtual (AR). Fluxo real de câmera + consentimento LGPD + telemetria.
 * O encaixe 3D exato (MediaPipe + Three.js sobre o GLB) é o próximo spike
 * (AR-2); aqui a armação é sobreposta via placeholder central, já com a
 * interface FaceTracker pronta para receber o rastreador real.
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
  const [asset, setAsset] = useState<ArAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<FaceBox | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef(new CenteredTracker());
  const startedAt = useRef<number>(0);
  const converted = useRef(false);

  useEffect(() => {
    getArAsset(productId).then(setAsset).catch(() => setAsset(null));
  }, [productId]);

  // Envia a telemetria de prova ao desmontar (sem imagem/biometria).
  useEffect(() => {
    startedAt.current = Date.now();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const durationMs = Date.now() - startedAt.current;
      if (startedAt.current > 0) {
        recordTryOn({ productId, storeId, durationMs, converted: converted.current }).catch(() => {});
      }
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      await trackerRef.current.start(videoRef.current as HTMLVideoElement);
      setBox(trackerRef.current.detect());
      setStep('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível acessar a câmera.');
      setStep('error');
    }
  }

  const addToCart = () => {
    converted.current = true;
    onAddToCart?.();
  };

  // Estilo da sobreposição da armação, a partir da caixa do rosto.
  const overlayStyle: React.CSSProperties | undefined = box
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
              Vamos usar a câmera do seu dispositivo para você provar a armação. O processamento é
              feito <strong>no seu aparelho</strong>; nenhuma imagem do seu rosto é enviada ou
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

        {step === 'starting' && <div className="empty">Iniciando a câmera…</div>}

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
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />
              {overlayStyle && <GlassesOverlay style={overlayStyle} />}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Prévia do encaixe (placeholder). O ajuste 3D exato sobre o rosto é o próximo passo
              (spike AR-2 com MediaPipe + modelo {asset?.type === 'GLB_3D' ? '3D' : '2D'}).
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

/** Sobreposição vetorial simples de uma armação (placeholder visual). */
function GlassesOverlay({ style }: { style: React.CSSProperties }) {
  return (
    <svg style={style} viewBox="0 0 200 70" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#0f1729" strokeWidth="5" fill="rgba(20,30,60,0.28)">
        <rect x="6" y="14" width="78" height="46" rx="16" />
        <rect x="116" y="14" width="78" height="46" rx="16" />
        <path d="M84 30 q16 -10 32 0" fill="none" />
        <path d="M6 26 L-2 20" fill="none" />
        <path d="M194 26 L202 20" fill="none" />
      </g>
    </svg>
  );
}
