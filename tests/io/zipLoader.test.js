// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import JSZip from 'jszip';
import {afterEach, describe, test, assert, vi} from 'vitest';
import {ZipLoader} from '../../src/io/zipLoader.js';

const dicom = readFileSync('tests/data/bbmri-53323131.dcm');

/**
 * Build a real ZIP without implicit directory entries.
 *
 * @param {Array} entries Archive entry name/content pairs.
 * @returns {Promise<ArrayBuffer>} ZIP bytes.
 */
async function archive(entries) {
  const zip = new JSZip();
  for (const [name, content] of entries) {
    zip.file(name, content, {createFolders: false});
  }
  return zip.generateAsync({type: 'arraybuffer'});
}

/**
 * Observe the public loader callbacks through completion.
 *
 * @param {ArrayBuffer} bytes ZIP bytes.
 * @returns {Promise<object>} Loader and callback spies.
 */
async function loadArchive(bytes) {
  const loader = new ZipLoader();
  const calls = {};
  const finished = new Promise((resolve) => {
    for (const type of ['loadstart',
      'progress',
      'loaditem',
      'load',
      'error',
      'abort',
      'loadend']) {
      calls[type] = vi.fn();
      loader[`on${type}`] = (event) => {
        calls[type](event);
        if (type === 'loadend') {
          resolve();
        }
      };
    }
  });
  loader.load(bytes, 'outer-private.zip', 0);
  await finished;
  return {loader, calls};
}

afterEach(() => vi.restoreAllMocks());

describe('ZIP image discovery', () => {
  test.each(['scan.dcm',
    'scan.DCM',
    'scan.dicom',
    'scan.DICOM',
    'IMAGE0001',
    'scan.IMA'])(
    '%s prevents filename conventions hiding valid DICOM pixels',
    async (name) => {
      const {loader, calls} = await loadArchive(await archive([[name, dicom]]));
      assert.deepEqual(calls.error.mock.calls, []);
      assert.equal(calls.loadstart.mock.calls.length, 1);
      assert.equal(calls.loaditem.mock.calls.length, 1);
      assert.equal(calls.load.mock.calls.length, 1);
      assert.equal(calls.loadend.mock.calls.length, 1);
      assert.equal(loader.isLoading(), false);
      const item = calls.loaditem.mock.calls[0][0];
      assert.equal(item.source, name);
      assert.equal(item.data.buffer.length, 65536);
      assert.equal(item.data.buffer.reduce((sum, value) => sum + value, 0),
        10070572);
      const progress = calls.progress.mock.calls.map(([event]) => event.loaded);
      assert.equal(progress.length > 0, true);
      assert.equal(progress.at(-1), 100);
    });

  test('mixed ZIP prevents sidecars and documentation becoming scan inputs',
    async () => {
      const bytes = await archive([
        ['series/scan.DCM', dicom],
        ['series/IMAGE0001', dicom],
        ['DICOMDIR', dicom],
        ['__MACOSX/private.dcm', dicom],
        ['series/._private.dcm', dicom],
        ['README.txt', 'documentation'],
        ['not-an-image.dcm.txt', 'text'],
        ['manual.pdf', 'documentation']
      ]);
      const {calls} = await loadArchive(bytes);
      assert.deepEqual(calls.error.mock.calls, []);
      assert.deepEqual(calls.loaditem.mock.calls.map(([event]) => event.source),
        ['series/scan.DCM', 'series/IMAGE0001']);
      assert.deepEqual(calls.loaditem.mock.calls.map(([event]) =>
        event.data.buffer.length), [65536, 65536]);
      assert.equal(calls.load.mock.calls.length, 1);
      assert.equal(calls.loadend.mock.calls.length, 1);
    });

  test('no-DICOM ZIP prevents suffix false positives and exposes safe counts',
    async () => {
      const bytes = await archive([
        ['folder/', null],
        ['__MACOSX/', null],
        ['README.txt', 'text'],
        ['private.dcm.txt', 'text'],
        ['DICOMDIR', dicom],
        ['__MACOSX/private.dcm', dicom],
        ['folder/._private', dicom]
      ]);
      const {calls} = await loadArchive(bytes);
      assert.equal(calls.error.mock.calls.length, 1);
      const failure = calls.error.mock.calls[0][0].error;
      assert.equal(failure.message, 'No DICOM file found in ZIP');
      assert.deepEqual(failure.archive, {
        fileCount: 5,
        directoryCount: 2,
        ignoredFileCount: 3,
        dicomFileCount: 0,
        types: [{extension: 'dcm', count: 1},
          {extension: 'none', count: 2},
          {extension: 'other', count: 2}]
      });
      assert.deepEqual(calls.loaditem.mock.calls, []);
      assert.deepEqual(calls.load.mock.calls, []);
      assert.equal(calls.loadend.mock.calls.length, 1);
    });

  test('corrupt ZIP prevents replacing the archive parser error', async () => {
    const {calls} = await loadArchive(new Uint8Array([1, 2, 3]).buffer);
    assert.equal(calls.error.mock.calls.length, 1);
    assert.equal(calls.error.mock.calls[0][0].error.message,
      'End of data reached (data length = 3, asked index = 4). ' +
      'Corrupted zip ?');
    assert.deepEqual(calls.loaditem.mock.calls, []);
    assert.equal(calls.loadend.mock.calls.length, 1);
  });

  test('abort during extraction prevents late parsing and duplicate completion',
    async () => {
      const bytes = await archive([['scan.dcm', dicom]]);
      const originalLoad = JSZip.loadAsync.bind(JSZip);
      let release;
      let started;
      let completed;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const extracting = new Promise((resolve) => {
        started = resolve;
      });
      const extracted = new Promise((resolve) => {
        completed = resolve;
      });
      vi.spyOn(JSZip, 'loadAsync').mockImplementation(async (buffer) => {
        const zip = await originalLoad(buffer);
        const entry = zip.file('scan.dcm');
        const extract = entry.async.bind(entry);
        entry.async = async (...args) => {
          const content = await extract(...args);
          started();
          await gate;
          completed();
          return content;
        };
        return zip;
      });
      const loader = new ZipLoader();
      const callbacks = {};
      for (const type of ['loadstart',
        'progress',
        'loaditem',
        'load',
        'error',
        'abort',
        'loadend']) {
        callbacks[type] = vi.fn();
        loader[`on${type}`] = callbacks[type];
      }
      loader.load(bytes, 'private.zip', 0);
      await extracting;
      loader.abort();
      release();
      await extracted;
      await delay(20);
      assert.equal(loader.isLoading(), false);
      assert.equal(callbacks.abort.mock.calls.length, 1);
      assert.equal(callbacks.loadend.mock.calls.length, 1);
      for (const type of ['progress', 'loaditem', 'load', 'error']) {
        assert.deepEqual(callbacks[type].mock.calls, []);
      }
    });
});

/**
 * Tests for the 'io/zipLoader.js' file.
 */

describe('io', () => {

  /**
   * Tests for {@link ZipLoader} events with single frame data.
   *
   * @function module:tests/io~zipLoaderCanloadurl
   */
  test('ZIP loader canloadurl - #DWV-REQ-IO-02-003 Load DICOM ZIP URL',
    () => {
      const loader = new ZipLoader();

      // 'ok' tests
      const okTestArgs = [
        {
          url: 'path/data.zip',
          options: {},
          desc: 'ok extension #0 (zip)'
        },
        {
          url: 'path/data.ext',
          options: {forceLoader: 'zip'},
          desc: 'ok force #0 (zip)'
        },
        {
          url: 'path/data.zip',
          options: {forceLoader: 'dicom'},
          desc: 'ok force #1 (dicom + zip ext)'
        },
        {
          url: 'path/data.ext',
          options: {requestHeaders: [
            {name: 'Accept', value: 'application/zip'}
          ]},
          desc: 'ok request #0 (zip)'
        },
      ];

      for (const testArg of okTestArgs) {
        assert.ok(
          loader.canLoadUrl(testArg.url, testArg.options),
          testArg.desc
        );
      }

      // 'notOk' tests
      const notOkTestArgs = [
        {
          url: 'path/data.dcm',
          options: {},
          desc: 'bad extension #0 (dcm)'
        },
        {
          url: 'path/data.ext',
          options: {},
          desc: 'bad options #0 (empty)'
        },
        {
          url: 'path/data.ext',
          options: {forceLoader: 'dicom'},
          desc: 'bad force #0 (dcm)'
        },
        {
          url: 'path/data.ext',
          options: {requestHeaders: [
            {name: 'Accept', value: 'application/dicom'}
          ]},
          desc: 'bad request #0 (dicom)'
        },
        {
          url: 'path/data.zip',
          options: {requestHeaders: [
            {name: 'Accept', value: 'application/dicom'}
          ]},
          desc: 'bad request #1 (dicom + zip ext)'
        }
      ];

      for (const testArg of notOkTestArgs) {
        assert.notOk(
          loader.canLoadUrl(testArg.url, testArg.options),
          testArg.desc
        );
      }
    }
  );

});
