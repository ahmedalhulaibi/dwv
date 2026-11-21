// @vitest-environment jsdom
import {afterEach, assert, test, vi} from 'vitest';
import {LayerGroup} from '../../src/gui/layerGroup.js';
import {View} from '../../src/image/view.js';
import {Image} from '../../src/image/image.js';
import {Geometry} from '../../src/image/geometry.js';
import {Size} from '../../src/image/size.js';
import {Spacing} from '../../src/image/spacing.js';
import {Index} from '../../src/math/index.js';
import {Point3D} from '../../src/math/point.js';
import {getIdentityMat33} from '../../src/math/matrix.js';

/**
 * Single spatial plane, optionally with ordinal time frames.
 *
 * @param {number} frames Number of independent frames.
 * @returns {Image} Viewable image.
 */
function image(frames) {
  const origin = new Point3D(0, 0, 0);
  const geometry = new Geometry([origin], new Size([2, 2, 1]),
    new Spacing([1, 1, 1]), undefined,
    frames > 1 ? {id: {value: 0}} : undefined);
  for (let time = 1; time < frames; time++) {
    geometry.appendFrame(origin, {id: {value: time}});
  }
  return new Image(geometry, new Uint8Array(4 * frames),
    Array.from({length: frames}, (_, index) => String(index)));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

test.each([[1, 3], [3, 1]])(
  'image replacement %s to %s prevents stale layer-group navigation bounds',
  (initial, replacement) => {
    const div = document.createElement('div');
    div.id = 'layerGroup0';
    document.body.append(div);
    const group = new LayerGroup(div);
    const layer = group.addViewLayer();
    vi.spyOn(layer, 'draw').mockImplementation(() => {});
    const view = new View(image(initial));
    view.setOrientation(getIdentityMat33());
    view.setCurrentIndex(new Index(initial > 1 ? [0, 0, 0, 0] : [0, 0, 0]),
      true);
    layer.setView(view, '0');
    layer.initialise({x: 2, y: 2}, {x: 1, y: 1}, 1);
    assert.deepEqual(group.getPositionHelper().getGeometry()
      .getSize().getValues(), initial > 1 ? [2, 2, 1, initial] : [2, 2, 1]);
    layer.onimageset(new CustomEvent('dataimageset', {
      detail: {dataid: '0', value: [image(replacement)]}
    }));
    const helper = group.getPositionHelper();
    assert.deepEqual(helper.getGeometry().getSize().getValues(),
      replacement > 1 ? [2, 2, 1, replacement] : [2, 2, 1]);
    if (replacement > 1) {
      assert.equal(helper.incrementPosition(3), true);
      assert.deepEqual(layer.getViewController().getCurrentIndex().getValues(),
        [0, 0, 0, 1]);
    } else {
      assert.equal(helper.incrementPositionAlongScroll(), false);
    }
  });
