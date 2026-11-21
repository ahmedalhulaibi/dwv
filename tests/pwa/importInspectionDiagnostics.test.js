// @vitest-environment jsdom
import {afterEach, assert, test} from 'vitest';
import {setupDiagnostics} from '../../app/diagnostics.js';

/**
 * Observe accepted parsed data through the diagnostics service boundary.
 *
 * @returns {object} Public API, service and report reader.
 */
function setup() {
  document.body.innerHTML = '<details id="error-diagnostics">' +
    '<textarea id="diagnostic-report" readonly></textarea>' +
    '<button id="copy-diagnostics">Copy</button>' +
    '<p id="copy-status" role="status"></p></details>';
  const service = new EventTarget();
  const api = setupDiagnostics(service, document,
    {now: () => '2026-11-21T03:00:00.000Z'});
  return {api,
    service,
    report: () => JSON.parse(document.getElementById('diagnostic-report')
      .value)};
}

const expected = {
  fileCount: 2,
  imageFileCount: 2,
  documentFileCount: 0,
  otherFileCount: 0,
  uniqueInstanceCount: 1,
  duplicateInstanceCount: 1,
  missingInstanceIdCount: 0,
  studyCount: 1,
  seriesCount: 1,
  groupCount: 1,
  omittedGroupCount: 0,
  groups: [{group: 1,
    type: 'ultrasound',
    fileCount: 2,
    uniqueInstanceCount: 1,
    duplicateInstanceCount: 1,
    positionTagCount: 0,
    orientationTagCount: 0,
    multiFrameFileCount: 0,
    dimensions: [{columns: 640, rows: 480, frames: 1, count: 2}],
    omittedDimensionCount: 0}]
};
const reportKeys = ['app',
  'droppedEvents',
  'environment',
  'events',
  'input',
  'inspection',
  'schema'];
const single = {...expected,
  fileCount: 1,
  imageFileCount: 1,
  duplicateInstanceCount: 0,
  groups: [{...expected.groups[0],
    fileCount: 1,
    duplicateInstanceCount: 0,
    dimensions: [{columns: 640, rows: 480, frames: 1, count: 1}]}]};

/**
 * Fresh parsed file identity, with intentionally private metadata.
 *
 * @returns {object} Load-item data.
 */
function data() {
  return {meta: {
    '00080016': {value: ['1.2.840.10008.5.1.4.1.1.6.1']},
    '00080018': {value: ['PRIVATE_INSTANCE']},
    '0020000D': {value: ['PRIVATE_STUDY']},
    '0020000E': {value: ['PRIVATE_SERIES']},
    '00280010': {value: [480]},
    '00280011': {value: [640]},
    '00100010': {value: ['PRIVATE_PATIENT']},
    '7FE00010': {value: [new Uint8Array([17, 29, 41])]}
  }};
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('accepted loaditems preserve safe inspection after completion failure',
  () => {
    const ui = setup();
    ui.api.beginFiles([{name: 'PRIVATE.zip', size: 123}], 'files');
    assert.equal('inspection' in ui.report(), false);
    const first = data();
    for (const item of [first, first, data()]) {
      ui.service.dispatchEvent(new CustomEvent('loaditem', {
        detail: {dataid: '0',
          data: item,
          source: '/PRIVATE/scan.dcm',
          metadata: 'PRIVATE_PATIENT'}
      }));
    }
    const failure = new Error('Cannot create image for multi-volume');
    delete failure.stack;
    ui.api.capture(failure, 'error', {dataid: '0'});
    ui.service.dispatchEvent(new CustomEvent('loadend',
      {detail: {dataid: '0'}}));
    assert.deepEqual(ui.report().inspection, expected);
    assert.deepEqual(ui.report().events, [
      {type: 'error',
        at: '2026-11-21T03:00:00.000Z',
        dataId: '0',
        error: {name: 'Error',
          message: 'Cannot create image for multi-volume'}},
      {type: 'loadend', at: '2026-11-21T03:00:00.000Z', dataId: '0'}
    ]);
    assert.deepEqual(Object.keys(ui.report()).sort(), reportKeys);
  });

test.each(['files', 'url'])(
  'new %s import resets inspection before observing another file', (method) => {
    const ui = setup();
    ui.service.dispatchEvent(new CustomEvent('loaditem',
      {detail: {data: data()}}));
    assert.deepEqual(ui.report().inspection, single);
    if (method === 'files') {
      ui.api.beginFiles([{name: 'new.zip', size: 1}], 'files');
    } else {
      ui.api.beginURLs(['https://example.invalid/new']);
    }
    assert.equal('inspection' in ui.report(), false);
    ui.service.dispatchEvent(new CustomEvent('loaditem',
      {detail: {data: data()}}));
    assert.deepEqual(ui.report().inspection, single);
  });

test.each(['00080018', '0020000D', '0020000E'])(
  'observed %s identity is redacted from a later actual error', (key) => {
    const ui = setup();
    const item = data();
    ui.service.dispatchEvent(new CustomEvent('loaditem',
      {detail: {data: item}}));
    const identifier = item.meta[key].value[0];
    const failure = new Error(`Duplicate identifier ${identifier}`);
    delete failure.stack;
    ui.api.capture(failure, 'error');
    assert.deepEqual(ui.report().events, [
      {type: 'error',
        at: '2026-11-21T03:00:00.000Z',
        error: {name: 'Error', message: 'Duplicate identifier [redacted]'}}
    ]);
    assert.deepEqual(ui.report().inspection, single);
    assert.deepEqual(Object.keys(ui.report()).sort(), reportKeys);
  });
