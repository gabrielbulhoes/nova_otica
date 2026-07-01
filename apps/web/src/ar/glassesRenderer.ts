import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FaceResult } from './tracker';

/**
 * Renderiza a armação 3D (Three.js) alinhada ao rosto usando os resultados da
 * MediaPipe. Posição/escala vêm dos landmarks; a rotação (yaw/pitch/roll) vem
 * da matriz de transformação facial. Se houver um GLB real, ele é usado; caso
 * contrário, cai numa malha procedural (a demo funciona sem assets externos).
 *
 * Observação: as constantes de encaixe (escala/anchoragem) precisam de
 * calibração e QA em dispositivo real — parte inerente do trabalho de AR.
 */
export class GlassesRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly group: THREE.Group; // container de transformação
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    // Câmera ortográfica cobrindo o vídeo normalizado (x:0..1, y:0..1 com y ↑).
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.camera.position.z = 2;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(0.3, 0.6, 1);
    this.scene.add(dir);

    this.group = new THREE.Group();
    this.group.add(buildProceduralGlasses());
    this.group.visible = false;
    this.scene.add(this.group);
  }

  /** Tenta carregar um GLB real; em falha, mantém a malha procedural. */
  async loadModel(url?: string, type?: string): Promise<void> {
    if (type !== 'GLB_3D' || !url) return;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      normalizeToUnitWidth(gltf.scene);
      this.group.clear();
      this.group.add(gltf.scene);
    } catch {
      /* mantém o fallback procedural */
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  update(result: FaceResult): void {
    const { box, matrix } = result;
    this.group.visible = true;
    this.group.position.set(box.cx, 1 - box.cy, 0);
    this.group.scale.setScalar(box.width);

    if (matrix && matrix.length === 16) {
      this.tmpMatrix.fromArray(matrix);
      this.tmpQuat.setFromRotationMatrix(this.tmpMatrix);
      this.group.quaternion.copy(this.tmpQuat);
    } else {
      this.group.rotation.set(0, 0, (-box.roll * Math.PI) / 180);
    }
    this.renderer.render(this.scene, this.camera);
  }

  clear(): void {
    this.group.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/** Armação procedural (~1 unidade de largura, centrada na origem). */
function buildProceduralGlasses(): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f1729, metalness: 0.3, roughness: 0.5 });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x88aaff,
    transparent: true,
    opacity: 0.22,
    metalness: 0.1,
    roughness: 0.1,
  });

  const lensR = 0.2;
  const tube = 0.025;
  const offset = 0.3;

  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(lensR, tube, 12, 32), frameMat);
    ring.position.set(sx * offset, 0, 0);
    g.add(ring);

    const lens = new THREE.Mesh(new THREE.CircleGeometry(lensR, 24), lensMat);
    lens.position.set(sx * offset, 0, -0.002);
    g.add(lens);

    // Haste (temple) indo para trás (-z).
    const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 8), frameMat);
    temple.rotation.x = Math.PI / 2;
    temple.position.set(sx * (offset + lensR), 0, -0.22);
    g.add(temple);
  }

  // Ponte entre as lentes.
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, offset * 2 - lensR * 2 + 0.02, 8), frameMat);
  bridge.rotation.z = Math.PI / 2;
  g.add(bridge);

  return g;
}

/** Centraliza e escala um objeto para ~1 unidade de largura (eixo X). */
function normalizeToUnitWidth(obj: THREE.Object3D): void {
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  obj.position.sub(center);
  const s = size.x > 0 ? 1 / size.x : 1;
  obj.scale.setScalar(s);
}
