import { expect, it } from 'vitest';
import * as THREE from 'three';
import { URDFJoint, URDFLink } from 'urdf-loader/src/URDFClasses.js';
import { jointAxisFrame, missingMeshPlaceholder, normalizePlaceholders, validMeshGeometry, visibleBounds, previewBounds, updateJointConnection } from '../src/components/previewGeometry';
import { previewMeshReferences, uniqueOwners } from '../src/components/previewResources';
import { xmlDocument } from '../src/core/documents/xml';

const close = (actual: THREE.Vector3, expected: number[]) => actual.toArray().forEach((n, i) => expect(n).toBeCloseTo(expected[i], 8));
it('transforms an authored joint axis through parent rotation and the current revolute pose', () => {
  const parent = new THREE.Group(), joint = new URDFJoint(); parent.position.set(2, 3, 4); parent.rotation.z = Math.PI / 2;
  joint.jointType = 'revolute'; joint.limit.lower = -10; joint.limit.upper = 10; joint.axis.set(1, 0, 0); joint.position.set(1, 0, 0); parent.add(joint); joint.setJointValue(.7);
  close(jointAxisFrame(joint)!.origin, [2, 4, 4]); close(jointAxisFrame(joint)!.direction, [0, 1, 0]);
  joint.setJointValue(-.3); close(jointAxisFrame(joint)!.direction, [0, 1, 0]);
});
it('keeps the arrow in the current prismatic frame and does not invent an axis for fixed/floating joints', () => {
  const parent = new THREE.Group(), joint = new URDFJoint(); parent.rotation.z = Math.PI / 2;
  joint.jointType = 'prismatic'; joint.axis.set(1, 0, 0); joint.limit.lower = -10; joint.limit.upper = 10; parent.add(joint); joint.setJointValue(.4);
  close(jointAxisFrame(joint)!.origin, [0, .4, 0]); close(jointAxisFrame(joint)!.direction, [0, 1, 0]);
  for (const type of ['fixed', 'floating'] as const) { joint.jointType = type; expect(jointAxisFrame(joint)).toBeUndefined(); }
  joint.jointType = 'planar'; joint.axis.set(0, 0, 2); close(jointAxisFrame(joint)!.direction, [0, 0, 1]);
  joint.axis.set(0, 0, 0); expect(jointAxisFrame(joint)).toBeUndefined();
});
it('uses a visible, fixed-size placeholder at the declared mesh origin for different asset unit scales', () => {
  for (const scale of [.001, 1000, -2]) {
    const geometryGroup = new THREE.Group(); geometryGroup.scale.setScalar(scale); geometryGroup.position.set(1, 2, 3);
    geometryGroup.add(missingMeshPlaceholder()); normalizePlaceholders(geometryGroup);
    const bounds = visibleBounds(geometryGroup); close(bounds.getCenter(new THREE.Vector3()), [1, 2, 3]); close(bounds.getSize(new THREE.Vector3()), [.08, .08, .08]);
    geometryGroup.visible = false; expect(visibleBounds(geometryGroup).isEmpty()).toBe(true);
  }
});
it('rejects empty or non-finite mesh geometry before computing preview bounds', () => {
  expect(validMeshGeometry(new THREE.BufferGeometry())).toBe(false);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  expect(validMeshGeometry(geometry)).toBe(true); geometry.getAttribute('position').setX(1, NaN); expect(validMeshGeometry(geometry)).toBe(false);
});
it('collects all standard visual/collision owners and ignores opaque legacy hardware and extensions', () => {
  const doc = xmlDocument('<robot name="r"><hardware><mesh filename="ignore.stl"/></hardware><link name="base"><visual><geometry><mesh filename="a.stl"/></geometry><hardware><mesh filename="also-ignore.stl"/></hardware></visual><collision><geometry><mesh filename="a.stl"/></geometry></collision><custom><mesh filename="extension.stl"/></custom></link></robot>');
  const refs = previewMeshReferences(doc);
  expect(refs).toEqual([{ uri: 'a.stl', owner: { link: 'base', mode: 'visual' } }, { uri: 'a.stl', owner: { link: 'base', mode: 'collision' } }]);
  expect(uniqueOwners([...refs.map(ref => ref.owner), refs[0].owner])).toHaveLength(2);
});

it('fits kinematic frames when geometry is absent and highlights the selected parent-to-joint connection', () => {
  const root = new URDFLink(), joint = new URDFJoint(); root.position.set(2, 3, 4); root.rotation.z = Math.PI / 2;
  joint.jointType = 'fixed'; joint.position.set(10, 0, 0); root.add(joint);
  const bounds = previewBounds(root); close(bounds.min, [2, 3, 4]); close(bounds.max, [2, 13, 4]);
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)));
  updateJointConnection(line, joint); expect(line.visible).toBe(true);
  const vertices = line.geometry.getAttribute('position'); close(new THREE.Vector3().fromBufferAttribute(vertices, 0), [2, 3, 4]); close(new THREE.Vector3().fromBufferAttribute(vertices, 1), [2, 13, 4]);
  updateJointConnection(line, undefined); expect(line.visible).toBe(false);
});
