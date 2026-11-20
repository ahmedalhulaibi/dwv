// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import JSZip from 'jszip';
import {afterEach, assert, test, vi} from 'vitest';
import {FilesLoader} from '../../src/io/filesLoader.js';

afterEach(() => vi.unstubAllGlobals());

test('abort after ZIP read prevents queued onload launching extraction',
  async () => {
    const zip = new JSZip();
    zip.file('scan.dcm', readFileSync('tests/data/bbmri-53323131.dcm'));
    const bytes = await zip.generateAsync({type: 'uint8array'});
    const file = new File([bytes], 'private.zip', {type: 'application/zip'});
    const NativeReader = FileReader;
    let ready;
    let release;
    let delivered;
    let reader;
    const completedRead = new Promise((resolve) => {
      ready = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    /**
     * Retain a real completed read while its load callback is queued.
     */
    class QueuedReader extends NativeReader {
      /**
       * Gate delivery of the completed read to the loader.
       *
       * @param {Function} callback Consumer's load callback.
       */
      set onload(callback) {
        super.onload = (event) => {
          reader = this;
          delivered = gate.then(() => callback(event));
          ready();
        };
      }
    }
    vi.stubGlobal('FileReader', QueuedReader);
    const loader = new FilesLoader();
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
    loader.load([file]);
    await completedRead;
    assert.equal(reader.readyState, 2);
    loader.abort();
    const progressAtAbort = callbacks.progress.mock.calls.length;
    release();
    await delivered;
    await delay(20);
    assert.equal(callbacks.abort.mock.calls.length, 1);
    assert.equal(callbacks.loadend.mock.calls.length, 1);
    assert.equal(callbacks.progress.mock.calls.length, progressAtAbort);
    for (const type of ['loaditem', 'load', 'error']) {
      assert.deepEqual(callbacks[type].mock.calls, []);
    }
  });
