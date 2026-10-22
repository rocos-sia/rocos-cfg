import * as THREE from 'three';

/** Unit arrow along +Y; actual meshes retain their thickness in WebGL. */
export class SolidArrow extends THREE.Group {
  readonly rotationArrow = new THREE.Group();
  constructor(color: number, rotation = false, overlay = false) {
    super();
    const material = new THREE.MeshBasicMaterial({ color, depthTest: !overlay, depthWrite: !overlay, transparent: overlay, opacity: overlay ? .95 : 1 });
    const mesh = (geometry: THREE.BufferGeometry, parent: THREE.Object3D = this) => {
      const part = new THREE.Mesh(geometry, material); part.renderOrder = overlay ? 999 : 0; parent.add(part); return part;
    };
    mesh(new THREE.CylinderGeometry(.018, .018, .84, 12)).position.y = .42;
    mesh(new THREE.ConeGeometry(.065, .16, 16)).position.y = .92;
    if (rotation) {
      this.add(this.rotationArrow);
      class Arc extends THREE.Curve<THREE.Vector3> {
        constructor() { super(); }
        getPoint(t: number, target = new THREE.Vector3()) {
          const angle = Math.PI * (.25 + t * 1.5);
          return target.set(.24 * Math.cos(angle), .68, -.24 * Math.sin(angle));
        }
      }
      const arc = new Arc(), angle = Math.PI * 1.75;
      mesh(new THREE.TubeGeometry(arc, 40, .016, 8, false), this.rotationArrow);
      const head = mesh(new THREE.ConeGeometry(.05, .12, 12), this.rotationArrow);
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle));
      head.position.copy(arc.getPoint(1)).addScaledVector(tangent, .06);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    }
  }
  setDirection(direction: THREE.Vector3) { this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); }
  setLength(length: number) { this.scale.setScalar(length); }
}

export function worldAxes(length = .5) {
  const axes = new THREE.Group();
  for (const [color, direction] of [[0xff0000, [1, 0, 0]], [0x00cc00, [0, 1, 0]], [0x0066ff, [0, 0, 1]]] as const) {
    const arrow = new SolidArrow(color); arrow.setDirection(new THREE.Vector3(...direction)); arrow.setLength(length); axes.add(arrow);
  }
  return axes;
}

const originalMaterials = new WeakMap<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
/** Restore authored alpha and depth settings exactly; never alter URDF data. */
export function applyTranslucency(model: THREE.Object3D, enabled: boolean) {
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      let original = originalMaterials.get(material);
      if (!original) {
        original = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
        originalMaterials.set(material, original);
      }
      const transparent = enabled || original.transparent;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = enabled ? original.opacity * .35 : original.opacity;
      material.depthWrite = enabled ? false : original.depthWrite;
    }
  });
}
