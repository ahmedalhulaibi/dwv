// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import JSZip from 'jszip';
import {afterEach, assert, test, vi} from 'vitest';
import {LoadController} from '../../src/app/loadController.js';

afterEach(() => vi.restoreAllMocks());

test.each(['unknown file', 'ZIP followed by unsupported file'])(
  '%s prevents abort-on-error creating duplicate completion or partial reads',
  async (variant) => {
    const unknown = new File(['unsupported'], 'private.unknown');
    const files = [unknown];
    if (variant === 'ZIP followed by unsupported file') {
      const zip = new JSZip();
      zip.file('scan.dcm', readFileSync('tests/data/bbmri-53323131.dcm'));
      files.unshift(new File([
        await zip.generateAsync({type: 'uint8array'})
      ], 'private.zip', {type: 'application/zip'}));
    }
    const reads = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    const controller = new LoadController();
    const events = [];
    const errors = [];
    for (const type of ['loadstart',
      'progress',
      'loaditem',
      'load',
      'error',
      'abort',
      'loadend']) {
      controller.addEventListener(type, (event) => {
        events.push(type);
        if (type === 'error') {
          errors.push(event.detail);
        }
      });
    }
    controller.addEventListener('error', (event) => {
      controller.abort(event.detail.dataid);
    });
    controller.loadFiles(files, '3');
    await delay(20);
    assert.deepEqual(events, ['loadstart', 'error', 'loadend']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].dataid, '3');
    assert.instanceOf(errors[0].error, Error);
    assert.equal(errors[0].error.message.length > 0, true);
    assert.deepEqual(reads.mock.calls, []);
    assert.deepEqual(controller.getLoadingDataIds(), []);
  });
