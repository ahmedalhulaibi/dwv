import {assert, test} from 'vitest';
import {DataController, DicomData} from '../../src/app/dataController.js';
import {Index} from '../../src/math/index.js';
import {getStructureElementsList} from '../../dev/dicom/dataStructures.js';
import syntheticData from '/tests/data/synthetic-img.json';

/**
 * Independent single-frame ultrasound image, without spatial placement tags.
 *
 * @param {number} ordinal Pixel value and unique image identity.
 * @returns {object} DICOM elements with distinct pixels.
 */
function elements(ordinal) {
  const config = structuredClone(syntheticData[0]);
  Object.assign(config.tags, {
    Modality: 'US',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.6.1',
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.6.1',
    SOPInstanceUID: `1.2.3.${ordinal}`,
    MediaStorageSOPInstanceUID: `1.2.3.${ordinal}`,
    InstanceNumber: ordinal
  });
  const meta = getStructureElementsList(config, '1.2.840.10008.1.2.1',
    {genOptions: {}})[0];
  meta['00200013'].value = [String(ordinal)];
  meta['00080018'].value = [`1.2.3.${ordinal}`];
  for (const key of ['00200032', '00200037', '00201041', '00280008']) {
    delete meta[key];
  }
  meta['7FE00010'].value.fill(ordinal);
  return meta;
}

/**
 * Feed the public data controller as the file load boundary does.
 *
 * @param {object[]} items Parsed DICOM image elements.
 * @returns {object} Completed data and completion result.
 */
function complete(items) {
  const controller = new DataController();
  for (const [index, meta] of items.entries()) {
    const data = new DicomData(meta);
    data.numberOfItems = items.length;
    data.buffer = meta['7FE00010'].value;
    if (index === 0) {
      controller.add('0', data);
    } else {
      controller.update('0', data);
    }
  }
  const result = controller.markDataAsComplete('0');
  return {data: controller.get('0'), result};
}

/**
 * Assert every image identity and pixel survives in its expected order.
 *
 * @param {object} image Resulting image.
 * @param {number[]} order Expected image ordinals.
 */
function assertSequence(image, order) {
  assert.deepEqual(image.getGeometry().getSize().getValues(),
    [32, 32, 1, order.length]);
  const pixels = image.getBuffer();
  assert.equal(pixels.length, 1024 * order.length);
  for (const [time, ordinal] of order.entries()) {
    const index = new Index([0, 0, 0, time]);
    assert.equal(image.getImageUid(index), `1.2.3.${ordinal}`);
    assert.deepEqual(Array.from(pixels.subarray(time * 1024,
      (time + 1) * 1024)), Array(1024).fill(ordinal));
    assert.equal(image.getGeometry().indexToWorld(index).get(2), 0);
  }
}

test('122 independent US images prevent silent one-image output', () => {
  const input = Array.from({length: 122}, (_, index) => 122 - index);
  const {data, result} = complete(input.map(elements));
  assert.deepEqual(result, {imageHasChanged: true});
  assert.equal(data.getComplete(), true);
  assertSequence(data.image, input.toReversed());
});

test.each([
  ['missing', [undefined, 1, 2]],
  ['duplicate', [1, 1, 2]],
  ['non-integer', [1, 1.5, 2]]
])('%s InstanceNumber preserves input order without losing images',
  (_name, numbers) => {
    const order = [3, 1, 2];
    const items = order.map(elements);
    for (const [index, value] of numbers.entries()) {
      if (typeof value === 'undefined') {
        delete items[index]['00200013'];
      } else {
        items[index]['00200013'].value = [String(value)];
      }
    }
    const {data, result} = complete(items);
    assert.deepEqual(result, {imageHasChanged: true});
    assert.equal(data.getComplete(), true);
    assertSequence(data.image, order);
  });

test('one independent US image retains ordinary three-dimensional geometry',
  () => {
    const {data, result} = complete([elements(1)]);
    assert.deepEqual(result, {imageHasChanged: false});
    assert.equal(data.getComplete(), true);
    assert.deepEqual(data.image.getGeometry().getSize().getValues(),
      [32, 32, 1]);
  });

test('positioned US retains spatial stacking', () => {
  const items = [1, 2, 3].map(elements);
  for (const [index, item] of items.entries()) {
    const spatial = getStructureElementsList(syntheticData[0],
      '1.2.840.10008.1.2.1', {genOptions: {}})[0];
    item['00200032'] = spatial['00200032'];
    item['00200032'].value = [0, 0, index];
    item['00200037'] = spatial['00200037'];
  }
  const {data, result} = complete(items);
  assert.deepEqual(result, {imageHasChanged: false});
  assert.equal(data.getComplete(), true);
  assert.deepEqual(data.image.getGeometry().getSize().getValues(), [32, 32, 3]);
});

test.each(['non-US class',
  'mixed series',
  'missing series',
  'duplicate image identity',
  'missing image identity',
  'orientation tag present',
  'multiple frames'])(
  '%s prevents speculative reinterpretation as an independent US sequence',
  (variant) => {
    const items = [1, 2, 3].map(elements);
    if (variant === 'non-US class') {
      for (const item of items) {
        item['00080016'].value = ['1.2.840.10008.5.1.4.1.1.4'];
        item['00080060'].value = ['MR'];
      }
    } else if (variant === 'mixed series') {
      items[1]['0020000E'].value = ['1.2.3.999'];
    } else if (variant === 'missing series') {
      delete items[1]['0020000E'];
    } else if (variant === 'duplicate image identity') {
      items[1]['00080018'].value = items[0]['00080018'].value;
    } else if (variant === 'missing image identity') {
      delete items[1]['00080018'];
    } else if (variant === 'orientation tag present') {
      items[1]['00200037'] = getStructureElementsList(syntheticData[0],
        '1.2.840.10008.1.2.1', {genOptions: {}})[0]['00200037'];
    } else {
      items[1]['00280008'] = {vr: 'IS', value: ['2']};
    }
    assert.throws(() => complete(items));
  });
