import {assert, test} from 'vitest';
import {ImportInspection} from '../../app/importInspection.js';

const empty = {
  fileCount: 0,
  imageFileCount: 0,
  documentFileCount: 0,
  otherFileCount: 0,
  uniqueInstanceCount: 0,
  duplicateInstanceCount: 0,
  missingInstanceIdCount: 0,
  studyCount: 0,
  seriesCount: 0,
  groupCount: 0,
  groups: [],
  omittedGroupCount: 0
};
const us = '1.2.840.10008.5.1.4.1.1.6.1';
const pdf = '1.2.840.10008.5.1.4.1.1.104.1';

/**
 * Parsed file metadata at the public collector boundary.
 *
 * @param {object} options Selected header values.
 * @returns {object} Metadata with private context and unreadable pixels.
 */
function meta(options = {}) {
  const result = {};
  for (const [key, value] of Object.entries({
    '00080016': options.sop ?? us,
    '00080018': options.uid ?? '1.2.3.1',
    '0020000D': options.study ?? '1.2.3.10',
    '0020000E': options.series ?? '1.2.3.20'
  })) {
    result[key] = {value: [value]};
  }
  if (options.pixel !== false) {
    result['7FE00010'] = {get value() {
      throw new Error('Pixel values must not be inspected');
    }};
    result['00280010'] = {value: [options.rows ?? 480]};
    result['00280011'] = {value: [options.columns ?? 640]};
  }
  if (typeof options.frames !== 'undefined') {
    result['00280008'] = {value: [options.frames]};
  }
  if (options.position) {
    result['00200032'] = {value: []};
  }
  if (options.orientation) {
    result['00200037'] = {value: []};
  }
  result.private = {source: '/PRIVATE_PATIENT/scan.dcm'};
  result.raw = result;
  return result;
}

/**
 * Expected group with one ordinary file.
 *
 * @param {string} type Safe class category.
 * @param {object[]} dimensions Safe dimensions.
 * @returns {object} Aggregate group.
 */
function group(type, dimensions) {
  return {
    group: 1,
    type,
    fileCount: 1,
    uniqueInstanceCount: 1,
    duplicateInstanceCount: 0,
    positionTagCount: 0,
    orientationTagCount: 0,
    multiFrameFileCount: 0,
    dimensions,
    omittedDimensionCount: 0
  };
}

test.each([
  [us, true, 'ultrasound'],
  ['1.2.840.10008.5.1.4.1.1.3.1', true, 'ultrasound-multiframe'],
  ['1.2.840.10008.5.1.4.1.1.7', true, 'secondary-capture'],
  [pdf, false, 'encapsulated-pdf'],
  [pdf, true, 'other-image'],
  ['1.2.840.10008.5.1.4.1.1.4', true, 'other-image'],
  [us, false, 'other'],
  ['PRIVATE_CLASS', false, 'other']
])('%s pixel=%s emits only safe category %s', (sop, pixel, type) => {
  const inspection = new ImportInspection();
  inspection.add({meta: meta({sop, pixel})});
  const document = type === 'encapsulated-pdf';
  assert.deepEqual(inspection.getSummary(), {
    ...empty,
    fileCount: 1,
    imageFileCount: pixel ? 1 : 0,
    documentFileCount: document ? 1 : 0,
    otherFileCount: !pixel && !document ? 1 : 0,
    uniqueInstanceCount: 1,
    studyCount: 1,
    seriesCount: 1,
    groupCount: 1,
    groups: [group(type,
      pixel ? [{columns: 640, rows: 480, frames: 1, count: 1}] : [])]
  });
});

test('file identity separates repeated frames and duplicate files', () => {
  const inspection = new ImportInspection();
  const first = meta({frames: '3', position: true});
  inspection.add({meta: first, frameNumber: 0});
  inspection.add({meta: first, frameNumber: 1});
  inspection.add({meta: meta({frames: '3', position: true})});
  inspection.add({meta: meta({uid: '1.2.3.2',
    sop: '1.2.840.10008.5.1.4.1.1.7',
    orientation: true})});
  inspection.add({meta: meta({uid: '1.2.3.3',
    series: '1.2.3.21',
    sop: pdf,
    pixel: false})});
  assert.deepEqual(inspection.getSummary(), {
    ...empty,
    fileCount: 4,
    imageFileCount: 3,
    documentFileCount: 1,
    uniqueInstanceCount: 3,
    duplicateInstanceCount: 1,
    studyCount: 1,
    seriesCount: 2,
    groupCount: 3,
    groups: [
      {...group('ultrasound', [{columns: 640, rows: 480, frames: 3, count: 2}]),
        fileCount: 2,
        duplicateInstanceCount: 1,
        positionTagCount: 2,
        multiFrameFileCount: 2},
      {...group('secondary-capture',
        [{columns: 640, rows: 480, frames: 1, count: 1}]),
      group: 2,
      orientationTagCount: 1},
      {...group('encapsulated-pdf', []), group: 3}
    ]
  });
});

test('missing identities never become duplicate instances or exported values',
  () => {
    const inspection = new ImportInspection();
    for (let index = 0; index < 2; index++) {
      const item = meta();
      for (const key of ['00080018', '0020000D', '0020000E']) {
        delete item[key];
      }
      inspection.add({meta: item});
    }
    assert.deepEqual(inspection.getSummary(), {...empty,
      fileCount: 2,
      imageFileCount: 2,
      missingInstanceIdCount: 2,
      groupCount: 1,
      groups: [{...group('ultrasound',
        [{columns: 640, rows: 480, frames: 1, count: 2}]),
      fileCount: 2,
      uniqueInstanceCount: 0}]});
  });

test('invalid metadata and dimensions cannot expose raw values', () => {
  const inspection = new ImportInspection();
  for (const data of [undefined, null, {}, {meta: null}, {meta: 'PRIVATE'}]) {
    inspection.add(data);
  }
  assert.deepEqual(inspection.getSummary(), empty);
  for (const options of [{rows: 0}, {columns: 'PRIVATE'}, {frames: 1.5}]) {
    inspection.add({meta: meta(options)});
  }
  assert.deepEqual(inspection.getSummary(), {...empty,
    fileCount: 3,
    imageFileCount: 3,
    uniqueInstanceCount: 1,
    duplicateInstanceCount: 2,
    studyCount: 1,
    seriesCount: 1,
    groupCount: 1,
    groups: [{...group('ultrasound', []),
      fileCount: 3,
      duplicateInstanceCount: 2}]});
});

test('group limit retains global counts and reports omitted groups', () => {
  const inspection = new ImportInspection();
  for (let index = 1; index <= 129; index++) {
    inspection.add({meta: meta({uid: `1.2.3.${index}`,
      series: `1.2.4.${index}`})});
  }
  assert.deepEqual(inspection.getSummary(), {...empty,
    fileCount: 129,
    imageFileCount: 129,
    uniqueInstanceCount: 129,
    studyCount: 1,
    seriesCount: 129,
    groupCount: 129,
    omittedGroupCount: 1,
    groups: Array.from({length: 128}, (_, index) =>
      ({...group('ultrasound',
        [{columns: 640, rows: 480, frames: 1, count: 1}]),
      group: index + 1}))});
});

test('dimension limit exposes truncation without losing file counts', () => {
  const inspection = new ImportInspection();
  for (let index = 1; index <= 17; index++) {
    inspection.add({meta: meta({uid: `1.2.3.${index}`, columns: index})});
  }
  assert.deepEqual(inspection.getSummary(), {...empty,
    fileCount: 17,
    imageFileCount: 17,
    uniqueInstanceCount: 17,
    studyCount: 1,
    seriesCount: 1,
    groupCount: 1,
    groups: [{...group('ultrasound',
      Array.from({length: 16}, (_, index) =>
        ({columns: index + 1, rows: 480, frames: 1, count: 1}))),
    fileCount: 17,
    uniqueInstanceCount: 17,
    omittedDimensionCount: 1}]});
});
