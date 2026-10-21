import { describe, expect, it } from 'vitest';
import { previewPose } from '../src/components/previewPose';

const joint = (name = 'axis', type = 'revolute', lower = '-1', upper = '1') => ({ name, type, lower, upper });
describe('local model preview pose', () => {
  it('retains compatible positions, clamps tightened limits and removes stale joints', () => {
    const previous = { types: { axis: 'revolute', removed: 'revolute' }, values: { axis: .8, removed: .3 } };
    expect(previewPose([joint()], previous).values).toEqual({ axis: .8 });
    expect(previewPose([joint('axis', 'revolute', '-1', '.4')], previous).values).toEqual({ axis: .4 });
    expect(previous.values.axis).toBe(.8);
  });
  it('starts renamed or changed types at a neutral position inside the new range', () => {
    const previous = { types: { axis: 'revolute' }, values: { axis: .8 } };
    expect(previewPose([joint('new', 'prismatic', '.2', '.5'), joint('axis', 'prismatic')], previous).values).toEqual({ new: .2, axis: 0 });
  });
  it('does not propagate invalid positions or invalid bounds into Three.js', () => {
    const previous = { types: { axis: 'revolute' }, values: { axis: NaN } };
    expect(previewPose([joint()], previous).values.axis).toBe(0);
    for (const bounds of [['', ''], ['3', '2'], ['NaN', '1'], ['0', 'Infinity']]) {
      expect(previewPose([joint('axis', 'revolute', ...bounds as [string, string])], previous).values.axis).toBe(0);
    }
    expect(previewPose([joint('axis', 'continuous')], { types: { axis: 'continuous' }, values: { axis: 10 } }).values.axis).toBe(Math.PI);
  });
});
