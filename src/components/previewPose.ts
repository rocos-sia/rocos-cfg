import type { RobotJointParameters } from '../core/documents/urdf';

type PreviewJoint = Pick<RobotJointParameters, 'name' | 'type' | 'lower' | 'upper'>;
export interface PreviewPose { types: Record<string, string>; values: Record<string, number> }

/** Retain compatible joints; renamed, removed or changed joint types start neutral. */
export function previewPose(joints: PreviewJoint[], previous?: PreviewPose): PreviewPose {
  const values: Record<string, number> = Object.create(null), types: Record<string, string> = Object.create(null);
  for (const joint of joints) {
    const lower = joint.type === 'continuous' ? -Math.PI : Number(joint.lower);
    const upper = joint.type === 'continuous' ? Math.PI : Number(joint.upper);
    const valid = (joint.type === 'continuous' || !!joint.lower && !!joint.upper)
      && Number.isFinite(lower) && Number.isFinite(upper) && lower <= upper;
    const retained = previous?.types[joint.name] === joint.type ? previous.values[joint.name] : 0;
    const value = Number.isFinite(retained) ? retained : 0;
    values[joint.name] = valid ? Math.max(lower, Math.min(upper, value)) : 0;
    types[joint.name] = joint.type;
  }
  return { types, values };
}
