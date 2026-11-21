// @vitest-environment jsdom
import {afterEach, assert, test} from 'vitest';
import {setupDiagnostics} from '../../app/diagnostics.js';

const instant = '2026-11-20T23:30:00.000Z';

/**
 * Capture a public load-end event with controlled output data capabilities.
 *
 * @param {object} detail Load-end detail.
 * @param {object} [outputs] Data controller entries by id.
 * @returns {object} Diagnostics report and controls.
 */
function record(detail, outputs) {
  document.body.innerHTML = '<details id="error-diagnostics">' +
    '<summary>Technical details</summary>' +
    '<textarea id="diagnostic-report" readonly></textarea>' +
    '<button id="copy-diagnostics">Copy</button>' +
    '<p id="copy-status" role="status"></p></details>';
  const service = new EventTarget();
  if (outputs) {
    service.getDataController = () => ({
      getDataIds: () => Object.keys(outputs),
      get: (id) => outputs[id]
    });
  }
  const api = setupDiagnostics(service, document, {now: () => instant});
  api.beginFiles([{name: 'PRIVATE_STUDY.zip', size: 122}], 'files');
  service.dispatchEvent(new CustomEvent('loadend', {detail}));
  return {
    report: JSON.parse(document.getElementById('diagnostic-report').value),
    details: document.getElementById('error-diagnostics')
  };
}

/**
 * Data controller boundary with intentionally private extra properties.
 *
 * @param {number[]} dimensions Output dimensions.
 * @param {*} complete Completion value.
 * @returns {object} Loaded dataset.
 */
function data(dimensions, complete) {
  return {
    image: {
      getGeometry: () => ({getSize: () => ({getValues: () => dimensions})}),
      getMeta: () => ({PatientName: 'PRIVATE_PATIENT'}),
      getBuffer: () => new Uint8Array([17, 29, 41])
    },
    getComplete: () => complete,
    source: 'https://private.example/PRIVATE_STUDY',
    metadata: {PatientName: 'PRIVATE_PATIENT'}
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('successful load reveals counts and dimensions without source metadata',
  () => {
    const archive = {
      fileCount: 122,
      directoryCount: 1,
      ignoredFileCount: 0,
      dicomFileCount: 1,
      skippedFileCount: 121,
      types: [{extension: 'jpg', count: 121, filename: 'PRIVATE_PATIENT'},
        {extension: 'dcm', count: 1}],
      paths: ['PRIVATE_STUDY/PRIVATE_PATIENT.dcm']
    };
    archive.raw = archive;
    const ui = record({dataid: '7',
      archive,
      source: 'PRIVATE_STUDY.zip',
      metadata: 'PRIVATE_PATIENT'}, {
      7: data([640, 480, 1], true),
      8: data([640, 480, 1, 122], false)
    });
    assert.deepEqual(ui.report.events, [{
      type: 'loadend',
      at: instant,
      dataId: '7',
      archive: {
        fileCount: 122,
        directoryCount: 1,
        ignoredFileCount: 0,
        dicomFileCount: 1,
        skippedFileCount: 121,
        types: [{extension: 'dcm', count: 1}, {extension: 'jpg', count: 121}]
      },
      output: [{dataId: '7', dimensions: [640, 480, 1], complete: true},
        {dataId: '8', dimensions: [640, 480, 1, 122], complete: false}]
    }]);
    assert.equal(ui.details.open, false);
  });

test.each([-1, 1.5, '121'])(
  'invalid skipped count %s prevents unsafe archive fields', (value) => {
    const ui = record({archive: {
      fileCount: 122,
      skippedFileCount: value,
      secret: 'PRIVATE_PATIENT',
      types: [{extension: 'PRIVATE_PATIENT', count: 1},
        {extension: 'dcm', count: '1'},
        {extension: 'jpg', count: 121, source: 'PRIVATE_STUDY'}]
    }});
    assert.deepEqual(ui.report.events, [{type: 'loadend',
      at: instant,
      archive: {fileCount: 122, types: [{extension: 'jpg', count: 121}]}}]);
  });

test.each([[],
  [0],
  [-1],
  [1.5],
  [Number.MAX_SAFE_INTEGER + 1],
  Array(9).fill(1)].map((dimensions) => [dimensions]))(
  'invalid dimensions %j prevent malformed dataset summaries', (dimensions) => {
    const ui = record({}, {
      0: data(dimensions, true),
      PRIVATE_PATIENT: data([640, 480, 1], true),
      1: data([1, 2, 3, 4, 5, 6, 7, 8], 'PRIVATE_PATIENT')
    });
    assert.deepEqual(ui.report.events, [{type: 'loadend',
      at: instant,
      output: [{dataId: '1', dimensions: [1, 2, 3, 4, 5, 6, 7, 8]}]}]);
  });

test('output limit prevents an unbounded dataset report', () => {
  const outputs = Object.fromEntries(Array.from({length: 129}, (_, id) =>
    [String(id), data([1], true)]));
  assert.deepEqual(record({}, outputs).report.events, [{
    type: 'loadend',
    at: instant,
    output: Array.from({length: 128}, (_, id) =>
      ({dataId: String(id), dimensions: [1], complete: true}))
  }]);
});

test('optional data capability preserves basic EventTarget integration', () => {
  assert.deepEqual(record({source: 'PRIVATE_STUDY'}).report.events,
    [{type: 'loadend', at: instant}]);
});
