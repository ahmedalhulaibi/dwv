// @vitest-environment jsdom
import {afterEach, assert, test} from 'vitest';
import {App} from '../../src/app/application.js';
import {DicomWriter} from '../../src/dicom/dicomWriter.js';
import {DataElement} from '../../src/dicom/dataElement.js';
import {getStructureElementsList} from '../../dev/dicom/dataStructures.js';
import syntheticData from '/tests/data/synthetic-img.json';

/**
 * DICOM buffers for real completion failures, without parser mocks.
 *
 * @param {number} ordinal Unique image/instance identity.
 * @param {string} kind MRI, ultrasound or encapsulated document.
 * @param {boolean} spatial Whether image geometry has patient positions.
 * @returns {ArrayBuffer} DICOM file bytes.
 */
function buffer(ordinal, kind, spatial = false) {
  const config = structuredClone(syntheticData[0]);
  if (kind !== 'MR') {
    Object.assign(config.tags, {
      Modality: kind === 'US' ? 'US' : 'DOC',
      SOPClassUID: kind === 'US' ? '1.2.840.10008.5.1.4.1.1.6.1'
        : '1.2.840.10008.5.1.4.1.1.104.1'
    });
    config.tags.MediaStorageSOPClassUID = config.tags.SOPClassUID;
  }
  const meta = getStructureElementsList(config, '1.2.840.10008.1.2.1',
    {genOptions: {}})[0];
  meta['00200013'].value = [String(ordinal)];
  meta['00080018'].value = [`1.2.3.${ordinal}`];
  meta['00020003'].value = [`1.2.3.${ordinal}`];
  if (spatial) {
    meta['00200032'].value = [0, 0, ordinal - 1];
  } else {
    delete meta['00200032'];
    delete meta['00200037'];
  }
  if (kind === 'DOC') {
    delete meta['7FE00010'];
    const document = new DataElement('OB');
    document.value = new Uint8Array([37, 80, 68, 70]);
    meta['00420011'] = document;
  }
  return new DicomWriter().getBuffer(meta);
}

let onUnhandled;
afterEach(() => {
  if (onUnhandled) {
    window.removeEventListener('error', onUnhandled);
  }
});

/**
 * Observe the public application load lifecycle and uncaught exceptions.
 *
 * @param {ArrayBuffer[]} buffers DICOM inputs.
 * @returns {object} Application and event observations.
 */
function load(buffers) {
  const app = new App();
  app.init({});
  const events = [];
  const failures = [];
  const unhandled = [];
  onUnhandled = (event) => {
    unhandled.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', onUnhandled);
  for (const type of ['loadstart',
    'loaditem',
    'error',
    'abort',
    'load',
    'loadend']) {
    app.addEventListener(type, (event) => {
      events.push(type);
      if (type === 'error') {
        failures.push(event.detail);
      }
    });
  }
  const dataId = app.loadImageObject(buffers.map((data, index) =>
    ({data, filename: `synthetic${index}.dcm`})));
  return {app, dataId, events, failures, unhandled};
}

test.each([
  ['ambiguous MRI',
    ['MR', 'MR'],
    'Error',
    'Cannot create image for multi-volume'],
  ['US images and document',
    ['US', 'US', 'DOC'],
    'TypeError',
    'Cannot read properties of undefined (reading \'getGeometry\')']
])('%s completion failure emits one error and cleans up the dataset',
  (_name, kinds, name, message) => {
    const result = load(kinds.map((kind, index) => buffer(index + 1, kind)));
    assert.deepEqual(result.events, ['loadstart',
      ...kinds.map(() => 'loaditem'),
      'error',
      'abort',
      'loadend']);
    assert.equal(result.failures.length, 1);
    const failure = result.failures[0];
    assert.equal(failure.dataid, result.dataId);
    assert.instanceOf(failure.error, Error);
    assert.equal(failure.error.name, name);
    assert.equal(failure.error.message, message);
    assert.deepEqual(result.app.getDataController().getDataIds(), []);
    assert.deepEqual(result.unhandled, []);
  });

test('successful completion retains load event and complete dataset', () => {
  const result = load([buffer(1, 'MR', true), buffer(2, 'MR', true)]);
  assert.deepEqual(result.events,
    ['loadstart', 'loaditem', 'loaditem', 'load', 'loadend']);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.unhandled, []);
  const data = result.app.getDataController().get(result.dataId);
  assert.equal(data.getComplete(), true);
  assert.deepEqual(data.image.getGeometry().getSize().getValues(), [32, 32, 2]);
});
