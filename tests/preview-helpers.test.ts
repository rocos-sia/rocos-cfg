import { expect, it } from 'vitest';
import * as THREE from 'three';
import { URDFJoint } from 'urdf-loader/src/URDFClasses.js';
import { applyTranslucency, SolidArrow, worldAxes } from '../src/components/previewHelpers';
import { disposeObject, updateJointAxis } from '../src/components/previewGeometry';

it('restores authored alpha and depth settings for shared, textured and multiple materials without cumulative fading', () => {
  const root = new THREE.Group(), texture = new THREE.Texture();
  const opaque = new THREE.MeshPhongMaterial({ map: texture }), transparent = new THREE.MeshBasicMaterial({ opacity: .4, transparent: true, depthWrite: false });
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [opaque, transparent]), new THREE.Mesh(new THREE.BoxGeometry(), opaque));
  for (let i = 0; i < 3; i++) {
    applyTranslucency(root, true); applyTranslucency(root, true);
    expect(opaque.opacity).toBe(.35); expect(transparent.opacity).toBeCloseTo(.14); expect(opaque.depthWrite).toBe(false);
    expect(opaque.map).toBe(texture);
    applyTranslucency(root, false);
    expect(opaque.opacity).toBe(1); expect(opaque.transparent).toBe(false); expect(opaque.depthWrite).toBe(true);
    expect(transparent.opacity).toBe(.4); expect(transparent.transparent).toBe(true); expect(transparent.depthWrite).toBe(false);
  }
  disposeObject(root);
});
it('draws solid XYZ arrows with their tips on the positive axes', () => {
  const axes = worldAxes(.5); axes.updateMatrixWorld(true);
  axes.children.forEach((arrow, i) => {
    const tip = arrow.localToWorld(new THREE.Vector3(0, 1, 0));
    tip.toArray().forEach((v, j) => expect(v).toBeCloseTo(i === j ? .5 : 0));
    expect(arrow.children.every(child => child instanceof THREE.Mesh)).toBe(true);
  });
  disposeObject(axes);
});
it('shows a right-handed arc for rotation and a straight arrow for translation in the transformed joint frame', () => {
  const arrow = new SolidArrow(0xd97706, true, true), joint = new URDFJoint();
  joint.jointType = 'revolute'; joint.axis.set(0, 0, -1); joint.position.set(1, 2, 3);
  updateJointAxis(arrow, joint, .4); arrow.updateMatrixWorld(true);
  expect(arrow.rotationArrow.visible).toBe(true);
  expect(arrow.localToWorld(new THREE.Vector3(0, 1, 0)).z).toBeCloseTo(2.6);
  const tube = arrow.rotationArrow.children[0] as THREE.Mesh<THREE.TubeGeometry>;
  const a = tube.geometry.parameters.path.getPoint(.5), b = tube.geometry.parameters.path.getPoint(.51);
  const radial = new THREE.Vector3(a.x, 0, a.z), tangent = b.clone().sub(a);
  expect(radial.cross(tangent).y).toBeGreaterThan(0);
  joint.jointType = 'prismatic'; updateJointAxis(arrow, joint, .4); expect(arrow.rotationArrow.visible).toBe(false);
  joint.jointType = 'fixed'; updateJointAxis(arrow, joint, .4); expect(arrow.visible).toBe(false);
  disposeObject(arrow);
});
