// @vitest-environment jsdom
import {afterEach, assert, describe, test} from 'vitest';
import {setupDiagnostics} from '../../app/diagnostics.js';

/**
 * Record an archive failure through the public diagnostics boundary.
 *
 * @param {object} archive Archive summary.
 * @returns {object} Serialized error record.
 */
function record(archive) {
  document.body.innerHTML = '<details id="error-diagnostics">' +
    '<textarea id="diagnostic-report" readonly></textarea>' +
    '<button id="copy-diagnostics">Copy</button>' +
    '<p id="copy-status" role="status"></p></details>';
  const api = setupDiagnostics(new EventTarget(), document,
    {now: () => '2026-11-20T23:00:00.000Z'});
  const failure = new Error('No DICOM file found in ZIP');
  delete failure.stack;
  failure.archive = archive;
  failure.source = 'PATIENT_PRIVATE.zip';
  api.capture(failure, 'error');
  return JSON.parse(document.getElementById('diagnostic-report').value)
    .events[0].error;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ZIP diagnostics whitelist', () => {
  test('archive summary prevents raw names and ZIP properties leaking', () => {
    const archive = {
      fileCount: 5,
      directoryCount: 2,
      ignoredFileCount: 1,
      dicomFileCount: 0,
      types: [{extension: 'other', count: 3, filename: 'PATIENT_PRIVATE'},
        {extension: 'dcm', count: 2}],
      names: ['PATIENT_PRIVATE/scan.dcm'],
      comment: 'PATIENT_PRIVATE'
    };
    archive.raw = archive;
    assert.deepEqual(record(archive), {
      name: 'Error',
      message: 'No DICOM file found in ZIP',
      archive: {
        fileCount: 5,
        directoryCount: 2,
        ignoredFileCount: 1,
        dicomFileCount: 0,
        types: [{extension: 'dcm', count: 2}, {extension: 'other', count: 3}]
      }
    });
  });

  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '8'])(
    'invalid archive count %s prevents unsafe summary values', (value) => {
      assert.deepEqual(record({
        fileCount: value,
        directoryCount: 0,
        ignoredFileCount: value,
        dicomFileCount: value,
        types: []
      }).archive, {directoryCount: 0, types: []});
    });

  test('type whitelist prevents unknown extensions and invalid counts leaking',
    () => {
      assert.deepEqual(record({
        fileCount: 1,
        types: [
          {extension: 'PATIENT_PRIVATE', count: 1},
          {extension: 'dcm', count: -1},
          {extension: 'png', count: 1.5},
          {extension: 'zip', count: '8'},
          {extension: 'none', count: 1, path: 'PATIENT_PRIVATE/scan'},
          null
        ]
      }).archive, {fileCount: 1, types: [{extension: 'none', count: 1}]});
    });
});
