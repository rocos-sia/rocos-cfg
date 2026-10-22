import * as THREE from 'three';
import type { URDFJoint } from 'urdf-loader';

export function disposeObject(object: THREE.Object3D) {
  object.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}
export function visibleBounds(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  object.traverseVisible(node => {
    if (node instanceof THREE.Mesh) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (node.geometry.boundingBox) box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }
  });
  return box;
}
export function previewBounds(model: THREE.Object3D) {
  const box = visibleBounds(model);
  if (box.isEmpty()) model.traverse(node => {
    if ('isURDFLink' in node || 'isURDFJoint' in node) box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld));
  });
  return box;
}
/** Fit all eight bounds corners in the actual viewport, with 20% padding. */
export function fitPreviewCamera(camera: THREE.PerspectiveCamera, bounds: THREE.Box3, direction: THREE.Vector3) {
  const box = bounds.isEmpty() ? new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, .3), new THREE.Vector3(1, 1, 1)) : bounds;
  const center = box.getCenter(new THREE.Vector3()), forward = direction.clone().normalize();
  camera.position.copy(center).add(forward); camera.lookAt(center);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), horizontal = vertical * camera.aspect;
  let distance = .36;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(center);
    distance = Math.max(distance, relative.dot(forward) + 1.2 * Math.max(Math.abs(relative.dot(right)) / horizontal, Math.abs(relative.dot(up)) / vertical));
  }
  camera.position.copy(center).addScaledVector(forward, distance);
  camera.far = Math.max(1000, distance + box.getSize(new THREE.Vector3()).length() * 4); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return center;
}
export const hasJointAxis = (type: string) => ['revolute', 'continuous', 'prismatic', 'planar'].includes(type);
export function jointAxisFrame(joint: URDFJoint) {
  if (!hasJointAxis(joint.jointType) || !Number.isFinite(joint.axis.lengthSq()) || joint.axis.lengthSq() === 0) return undefined;
  joint.updateWorldMatrix(true, false);
  return { origin: new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld), direction: joint.axis.clone().transformDirection(joint.matrixWorld) };
}
export function updateJointAxis(arrow: THREE.ArrowHelper, joint: URDFJoint | undefined, length: number) {
  const frame = joint && jointAxisFrame(joint); arrow.visible = !!frame;
  if (!frame) return;
  arrow.position.copy(frame.origin); arrow.setDirection(frame.direction); arrow.setLength(length, length * .25, length * .12);
}
export function updateJointConnection(line: THREE.Line, joint: URDFJoint | undefined) {
  line.visible = !!joint?.parent; if (!joint?.parent) return;
  joint.updateWorldMatrix(true, false);
  const parent = new THREE.Vector3().setFromMatrixPosition(joint.parent.matrixWorld), point = new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld);
  line.visible = parent.distanceToSquared(point) > 1e-16;
  const positions = line.geometry.getAttribute('position'); positions.setXYZ(0, parent.x, parent.y, parent.z); positions.setXYZ(1, point.x, point.y, point.z); positions.needsUpdate = true;
}
export function missingMeshPlaceholder() {
  // A group preserves this diagnostic material: URDFLoader replaces materials
  // on a direct Mesh with the URDF visual's material.
  const group = new THREE.Group(); group.userData.previewPlaceholder = true;
  const marker = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .08), new THREE.MeshBasicMaterial({ color: 0xd97706, wireframe: true, depthTest: false, transparent: true, opacity: .95 }));
  marker.renderOrder = 10; group.add(marker); return group;
}
export function normalizePlaceholders(model: THREE.Object3D) {
  model.traverse(node => {
    if (node.userData.previewPlaceholder && node.parent) {
      // The marker is 0.08 m, independent of the missing asset's authored units.
      const scale = node.parent.scale;
      node.scale.set(1 / (scale.x || 1), 1 / (scale.y || 1), 1 / (scale.z || 1));
    }
  });
}
export function validMeshGeometry(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position'); if (!positions || positions.count < 3) return false;
  for (let i = 0; i < positions.count; i++) if (!Number.isFinite(positions.getX(i)) || !Number.isFinite(positions.getY(i)) || !Number.isFinite(positions.getZ(i))) return false;
  return true;
}
