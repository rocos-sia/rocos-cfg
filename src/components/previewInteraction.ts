import * as THREE from 'three';

export interface DragBounds { left: number; top: number; width: number; height: number }
export function pointerRay(camera: THREE.Camera, bounds: DragBounds, x: number, y: number) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1), camera);
  return ray;
}
function screenPoint(point: THREE.Vector3, camera: THREE.Camera, bounds: DragBounds) {
  const projected = point.clone().project(camera);
  return new THREE.Vector2(bounds.left + (projected.x + 1) * bounds.width / 2, bounds.top + (1 - projected.y) * bounds.height / 2);
}

/** Freeze the drag frame so model movement cannot feed back into pointer mapping. */
export function jointDrag({ camera, bounds, origin, axis, point, x, y, value, min, max, prismatic }: {
  camera: THREE.Camera; bounds: DragBounds; origin: THREE.Vector3; axis: THREE.Vector3; point: THREE.Vector3;
  x: number; y: number; value: number; min: number; max: number; prismatic: boolean;
}) {
  const direction = axis.clone().normalize(), plane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction, origin);
  const ray = pointerRay(camera, bounds, x, y).ray;
  const initial = Math.abs(ray.direction.dot(direction)) > .15 ? ray.intersectPlane(plane, new THREE.Vector3()) : null;
  let previous = initial?.sub(origin).normalize();
  const angular = !prismatic && !!previous && previous.lengthSq() > .5;
  let angle = 0;
  // Edge-on rotation uses the projected tangent at the grabbed point. Translation
  // uses the projected axis; a view-aligned axis falls back to vertical movement.
  const radius = point.clone().sub(origin).addScaledVector(direction, -point.clone().sub(origin).dot(direction));
  if (radius.length() < .03) {
    radius.set(1, 0, 0).applyQuaternion(camera.quaternion);
    radius.addScaledVector(direction, -radius.dot(direction));
    if (radius.lengthSq() < 1e-8) radius.set(0, 1, 0).applyQuaternion(camera.quaternion).cross(direction);
    radius.normalize().multiplyScalar(.1);
  }
  const tangent = prismatic ? direction : direction.clone().cross(radius);
  const step = .001;
  const screen = screenPoint(point.clone().addScaledVector(tangent, step), camera, bounds).sub(screenPoint(point, camera, bounds)).divideScalar(step);
  if (screen.length() < 1) screen.set(0, -100);
  else if (screen.length() < 30) screen.setLength(30);
  return (clientX: number, clientY: number) => {
    let delta: number;
    if (angular) {
      const next = pointerRay(camera, bounds, clientX, clientY).ray.intersectPlane(plane, new THREE.Vector3());
      if (!next || next.distanceToSquared(origin) < 1e-10) return Math.max(min, Math.min(max, value + angle));
      next.sub(origin).normalize();
      angle += Math.atan2(direction.dot(previous!.clone().cross(next)), previous!.dot(next)); previous = next;
      delta = angle;
    } else delta = new THREE.Vector2(clientX - x, clientY - y).dot(screen) / screen.lengthSq();
    return Math.max(min, Math.min(max, value + delta));
  };
}

/** Clone only the selected link's materials; child links and shared materials stay intact. */
export function tintLink(link: THREE.Object3D) {
  const changed: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; clones: THREE.Material[] }[] = [];
  const visit = (node: THREE.Object3D) => {
    if (node !== link && 'isURDFLink' in node) return;
    if (node instanceof THREE.Mesh) {
      const original = node.material;
      const clones = (Array.isArray(original) ? original : [original]).map(material => {
        const clone = material.clone();
        if ('color' in clone && clone.color instanceof THREE.Color) clone.color.multiplyScalar(.55);
        return clone;
      });
      node.material = Array.isArray(original) ? clones : clones[0]; changed.push({ mesh: node, original, clones });
    }
    node.children.forEach(visit);
  };
  visit(link);
  return () => { for (const { mesh, original, clones } of changed) { mesh.material = original; clones.forEach(material => material.dispose()); } };
}
