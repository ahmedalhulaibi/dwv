// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import {assert, test, vi} from 'vitest';
import {ZipLoader} from '../../src/io/zipLoader.js';
import {FilesLoader} from '../../src/io/filesLoader.js';

const dicom = readFileSync('tests/data/bbmri-53323131.dcm');

/**
 * Create an archive at the consumer boundary.
 *
 * @param {number} discovered DICOM entry count.
 * @param {number} skipped Non-DICOM entry count.
 * @returns {Promise<Uint8Array>} ZIP bytes.
 */
async function zipBytes(discovered, skipped) {
  const zip = new JSZip();
  zip.file('PRIVATE_STUDY/', null, {dir: true, createFolders: false});
  for (let i = 0; i < discovered; i++) {
    zip.file(`PRIVATE_STUDY/IMAGE${i}.DCM`, dicom, {createFolders: false});
  }
  for (let i = 0; i < skipped; i++) {
    zip.file(`PRIVATE_STUDY/IMAGE${i}.jpg`, new Uint8Array([255, 216, 255]),
      {createFolders: false});
  }
  zip.file('DICOMDIR', dicom, {createFolders: false});
  return zip.generateAsync({type: 'uint8array'});
}

/**
 * Observe real ZIP parsing directly or through the selected-file boundary.
 *
 * @param {Uint8Array} bytes Archive bytes.
 * @param {boolean} files Whether to use FilesLoader.
 * @returns {Promise<object>} Public callback observations.
 */
async function observe(bytes, files = false) {
  const loader = files ? new FilesLoader() : new ZipLoader();
  const events = {};
  const end = new Promise((resolve) => {
    for (const type of ['loaditem', 'load', 'error', 'loadend']) {
      events[type] = vi.fn();
      loader[`on${type}`] = (event) => {
        events[type](event);
        if (type === 'loadend') {
          resolve();
        }
      };
    }
  });
  if (files) {
    loader.load([new File([bytes], 'PRIVATE_STUDY.zip')]);
  } else {
    loader.load(bytes.buffer, 'PRIVATE_STUDY.zip', 0);
  }
  await end;
  return events;
}

test.each([
  ['all122 DICOM entries', 122, 0],
  ['one DICOM among122 image entries', 1, 121]
])('%s prevents a successful ZIP hiding partial discovery',
  async (_name, discovered, skipped) => {
    const events = await observe(await zipBytes(discovered, skipped));
    assert.deepEqual(events.error.mock.calls, []);
    assert.equal(events.loaditem.mock.calls.length, discovered);
    assert.equal(events.load.mock.calls.length, 1);
    assert.equal(events.loadend.mock.calls.length, 1);
    const types = [{extension: 'dcm', count: discovered}];
    if (skipped !== 0) {
      types.push({extension: 'jpg', count: skipped});
    }
    types.push({extension: 'none', count: 1});
    assert.deepEqual(events.loadend.mock.calls[0][0].archive, {
      fileCount: 123,
      directoryCount: 1,
      ignoredFileCount: 1,
      dicomFileCount: discovered,
      skippedFileCount: skipped,
      types
    });
    assert.equal(events.loaditem.mock.calls[0][0].data.buffer.length, 65536);
  });

test('selected ZIP prevents FilesLoader discarding discovery summary',
  async () => {
    const events = await observe(await zipBytes(1, 2), true);
    assert.deepEqual(events.error.mock.calls, []);
    assert.equal(events.loadend.mock.calls.length, 1);
    assert.deepEqual(events.loadend.mock.calls[0][0].archive, {
      fileCount: 4,
      directoryCount: 1,
      ignoredFileCount: 1,
      dicomFileCount: 1,
      skippedFileCount: 2,
      types: [{extension: 'dcm', count: 1},
        {extension: 'jpg', count: 2},
        {extension: 'none', count: 1}]
    });
  });

test('empty discovery exposes completion counts and preserves failure schema',
  async () => {
    const events = await observe(await zipBytes(0, 2));
    assert.equal(events.error.mock.calls.length, 1);
    assert.equal(events.loadend.mock.calls.length, 1);
    const summary = {
      fileCount: 3,
      directoryCount: 1,
      ignoredFileCount: 1,
      dicomFileCount: 0,
      types: [{extension: 'jpg', count: 2}, {extension: 'none', count: 1}]
    };
    assert.equal(events.error.mock.calls[0][0].error.message,
      'No DICOM file found in ZIP');
    assert.deepEqual(events.error.mock.calls[0][0].error.archive, summary);
    assert.deepEqual(events.loadend.mock.calls[0][0].archive,
      {...summary, skippedFileCount: 2});
    assert.deepEqual(events.loaditem.mock.calls, []);
  });
