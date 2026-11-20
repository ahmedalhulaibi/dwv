// @vitest-environment jsdom
import {assert, test} from 'vitest';
import {ScrollDragBehavior} from '../../../src/tools/behaviors/dragBehavior.js';
import {PositionHelper} from '../../../src/image/positionHelper.js';
import {Geometry} from '../../../src/image/geometry.js';
import {Size} from '../../../src/image/size.js';
import {Spacing} from '../../../src/image/spacing.js';
import {Index} from '../../../src/math/index.js';
import {Point2D, Point3D} from '../../../src/math/point.js';

/**
 * Real spatial/time position boundary for a scroll tool consumer.
 *
 * @param {number} slices Spatial slice count.
 * @param {number[]} initial Initial index.
 * @returns {object} Layer group boundary and real helper.
 */
function createGroup(slices, initial) {
  const origins = Array.from({length: slices}, (_, z) =>
    new Point3D(10, -20, 30 + z * 5));
  const geometry = new Geometry(origins, new Size([4, 5, slices]),
    new Spacing([2, 3, 5]), undefined, {id: {value: 0}});
  for (let time = 1; time < 3; time++) {
    geometry.appendFrame(origins[0], {id: {value: time}});
    for (let z = 1; z < slices; z++) {
      geometry.appendOrigin(origins[z], z, time);
    }
  }
  let position = geometry.indexToWorld(new Index(initial));
  const helper = new PositionHelper({
    getImage: () => ({getGeometry: () => geometry}),
    getCurrentPosition: () => position,
    getScrollDimIndex: () => 2,
    setCurrentPosition: (next) => {
      position = next;
      return true;
    }
  });
  return {
    getPositionHelper: () => helper,
    canScroll: () => geometry.getSize().canScroll(),
    moreThanOne: (dim) => geometry.getSize().moreThanOne(dim)
  };
}

test.each([
  ['time-only upward advances frame',
    1,
    [1, 2, 0, 1],
    [0, -20],
    [1, 2, 0, 2]],
  ['time-only downward returns frame',
    1,
    [1, 2, 0, 1],
    [0, 20],
    [1, 2, 0, 0]],
  ['time-only last frame does not wrap',
    1,
    [1, 2, 0, 2],
    [0, -20],
    [1, 2, 0, 2]],
  ['time-only first frame does not wrap',
    1,
    [1, 2, 0, 0],
    [0, 20],
    [1, 2, 0, 0]],
  ['mixed upward keeps spatial scrolling',
    3,
    [1, 2, 1, 1],
    [0, -20],
    [1, 2, 2, 1]],
  ['mixed downward keeps spatial scrolling',
    3,
    [1, 2, 1, 1],
    [0, 20],
    [1, 2, 0, 1]],
  ['horizontal right keeps time scrolling',
    3,
    [1, 2, 1, 1],
    [20, 0],
    [1, 2, 1, 2]],
  ['horizontal left keeps time scrolling',
    3,
    [1, 2, 1, 1],
    [-20, 0],
    [1, 2, 1, 0]]
])('%s', (_name, slices, initial, delta, expected) => {
  const group = createGroup(slices, initial);
  const behavior = new ScrollDragBehavior();
  behavior.onStart(new Point2D(100, 100), group);
  behavior.onUpdate(new Point2D(100 + delta[0], 100 + delta[1]), group);
  behavior.onEnd();
  assert.deepEqual(group.getPositionHelper().getCurrentIndex().getValues(),
    expected);
  assert.equal(behavior.isActive(), false);
});
