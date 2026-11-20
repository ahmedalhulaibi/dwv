// @vitest-environment jsdom
import {afterEach, assert, describe, test, vi} from 'vitest';
import {setupDiagnostics} from '../../app/diagnostics.js';
import {getDwvVersion} from '../../src/dicom/dicomParser.js';

const instant = '2026-11-20T22:00:00.000Z';

/**
 * Build the diagnostics boundary with controlled browser capabilities.
 *
 * @param {object} [clipboard] Clipboard capability.
 * @returns {object} Public API, event source and report controls.
 */
function setup(clipboard) {
  document.body.innerHTML = '<script src="/app.a1b2c3.js?private=token">' +
    '</script><details id="error-diagnostics"><summary>Technical details' +
    '</summary><textarea id="diagnostic-report" readonly></textarea>' +
    '<button id="copy-diagnostics">Copy diagnostics</button>' +
    '<p id="copy-status" role="status"></p></details>';
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('TestBrowser/1.0');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: clipboard
  });
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: query === '(display-mode: standalone)'
  })));
  const service = new EventTarget();
  const api = setupDiagnostics(service, document, {now: () => instant});
  const textarea = document.getElementById('diagnostic-report');
  return {
    api,
    service,
    textarea,
    details: document.getElementById('error-diagnostics'),
    button: document.getElementById('copy-diagnostics'),
    status: document.getElementById('copy-status'),
    report: () => JSON.parse(textarea.value)
  };
}

/**
 * Create an error with deterministic stack text.
 *
 * @param {string} message Error message.
 * @param {string} [stack] Stack text.
 * @returns {Error} Error with no generated test-runner stack.
 */
function error(message, stack) {
  const result = new Error(message);
  if (typeof stack === 'undefined') {
    delete result.stack;
  } else {
    result.stack = stack;
  }
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.clipboard;
  document.body.innerHTML = '';
});

describe('PWA diagnostics', () => {
  test('report prevents loss of the actual ZIP error and app context', () => {
    const ui = setup();
    ui.api.beginFiles([{name: 'private-study.zip', size: 42}], 'files');
    const failure = error('No DICOM file found in ZIP',
      'Error: No DICOM file found in ZIP\n    at open (app.a1b2c3.js:12:34)');
    ui.api.capture(failure, 'error', {dataid: '7'});
    assert.deepEqual(ui.report(), {
      schema: 1,
      app: {version: getDwvVersion(), bundle: 'app.a1b2c3.js'},
      environment: {
        userAgent: 'TestBrowser/1.0', online: false, displayMode: 'standalone'
      },
      input: {
        method: 'files',
        fileCount: 1,
        totalBytes: 42,
        types: [{extension: 'zip', count: 1}]
      },
      events: [{
        type: 'error',
        at: instant,
        dataId: '7',
        error: {
          name: 'Error',
          message: 'No DICOM file found in ZIP',
          stack: failure.stack
        }
      }],
      droppedEvents: 0
    });
    assert.isFalse(ui.details.open);
    assert.equal(ui.textarea.readOnly, true);
  });

  test.each(['files', 'folder', 'drop'])(
    'input summary prevents filenames and unknown extensions leaking via %s',
    (method) => {
      const ui = setup();
      const names = ['patient.ZIP',
        'scan.DCM',
        'other.dcm',
        'DICOMDIR',
        'patient-secret.CUSTOM',
        'video.mp4',
        'image.jpeg',
        '.hidden'];
      ui.api.beginFiles(names.map((name) => ({name,
        size: 10,
        type: 'private-patient-mime'})), method);
      ui.api.capture(error('Import failed'), 'error');
      assert.deepEqual(ui.report().input, {
        method,
        fileCount: 8,
        totalBytes: 80,
        types: [
          {extension: 'dcm', count: 2},
          {extension: 'jpeg', count: 1},
          {extension: 'mp4', count: 1},
          {extension: 'none', count: 2},
          {extension: 'other', count: 1},
          {extension: 'zip', count: 1}
        ]
      });
    });

  test('URL import prevents source URLs appearing in the report', () => {
    const ui = setup();
    ui.api.beginURLs(['https://patient:secret@pacs.example/study?token=abc']);
    ui.api.capture(error('Request failed'), 'error');
    assert.deepEqual(ui.report().input, {
      method: 'url', fileCount: 1, totalBytes: 0, types: []
    });
    assert.deepEqual(ui.report().events, [{type: 'error',
      at: instant,
      error: {name: 'Error', message: 'Request failed'}}]);
  });

  test('extension vocabulary prevents rejecting safe formats or leaking names',
    () => {
      const ui = setup();
      ui.api.beginFiles([
        'private.avi',
        'private.bmp',
        'private.dcm',
        'private.dicom',
        'private.gif',
        'private.jpeg',
        'private.jpg',
        'private.mp4',
        'DICOMDIR',
        'private.custom',
        'private.pdf',
        'private.png',
        'private.webp',
        'private.zip'
      ].map((name) => ({name, size: 1})), 'files');
      ui.api.capture(error('Load failed'), 'error');
      assert.deepEqual(ui.report().input, {
        method: 'files',
        fileCount: 14,
        totalBytes: 14,
        types: [
          {extension: 'avi', count: 1},
          {extension: 'bmp', count: 1},
          {extension: 'dcm', count: 1},
          {extension: 'dicom', count: 1},
          {extension: 'gif', count: 1},
          {extension: 'jpeg', count: 1},
          {extension: 'jpg', count: 1},
          {extension: 'mp4', count: 1},
          {extension: 'none', count: 1},
          {extension: 'other', count: 1},
          {extension: 'pdf', count: 1},
          {extension: 'png', count: 1},
          {extension: 'webp', count: 1},
          {extension: 'zip', count: 1}
        ]
      });
    });

  test.each([
    ['filename',
      'Failed to open patient-secret.zip',
      'Failed to open [redacted]'],
    ['quoted value',
      'Unsupported value "PATIENT_SECRET"',
      'Unsupported value [redacted]'],
    ['single quoted value',
      'Unsupported value \'PATIENT_SECRET\'',
      'Unsupported value [redacted]'],
    ['URL',
      'Request https://user:secret@pacs.example/study?token=private failed',
      'Request [url] failed'],
    ['POSIX path',
      'Cannot read /home/patient/private/scan.dcm',
      'Cannot read [redacted]'],
    ['Windows path',
      'Cannot read C:\\Users\\patient\\private\\scan.dcm',
      'Cannot read [redacted]']
  ])('error text prevents leaking %s', (_label, message, expected) => {
    const ui = setup();
    ui.api.beginFiles([{name: 'patient-secret.zip', size: 1}], 'files');
    ui.api.capture(error(message), 'error');
    assert.deepEqual(ui.report().events, [{type: 'error',
      at: instant,
      error: {name: 'Error', message: expected}}]);
  });

  test('stack and causes prevent private text leaks while retaining app lines',
    () => {
      const ui = setup();
      ui.api.beginFiles([{name: 'patient-secret.zip', size: 1}], 'drop');
      const failure = error('Failed to read "PATIENT_SECRET"',
        'Error: Failed to read "PATIENT_SECRET"\n' +
        '    at decode (https://viewer.example/dwv/app.a1b2c3.js:12:34)\n' +
        '    at load (/home/patient/scan.dcm:7:8)');
      failure.cause = error('Invalid patient-secret.zip');
      failure.cause.name = 'TypeError';
      ui.api.capture(failure, 'error');
      assert.deepEqual(ui.report().events[0].error, {
        name: 'Error',
        message: 'Failed to read [redacted]',
        stack: 'Error: Failed to read [redacted]\n' +
          '    at decode (app.a1b2c3.js:12:34)\n' +
          '    at load ([redacted])',
        cause: {name: 'TypeError', message: 'Invalid [redacted]'}
      });
    });

  test('bounded causes prevent infinite reports from a cyclic error', () => {
    const ui = setup();
    const failure = error('Outer failure');
    failure.cause = error('Inner failure');
    failure.cause.cause = failure;
    assert.doesNotThrow(() => ui.api.capture(failure, 'error'));
    const recorded = ui.report().events[0].error;
    assert.equal(recorded.message, 'Outer failure');
    assert.equal(recorded.cause.message, 'Inner failure');
    let nested = recorded.cause;
    let count = 0;
    while (nested) {
      count++;
      nested = nested.cause;
    }
    assert.isAtMost(count, 3);
  });

  test.each(['error', 'timeout'])(
    '%s listener excludes raw source and metadata', (type) => {
      const ui = setup();
      const detail = {
        error: error('Load failed'),
        dataid: '17',
        source: {name: 'patient-secret.zip', patientName: 'PATIENT_SECRET'},
        metadata: {PatientName: 'PATIENT_SECRET'},
        pixelData: new Uint8Array([99, 42])
      };
      detail.circular = detail;
      ui.service.dispatchEvent(new CustomEvent(type, {detail}));
      assert.deepEqual(ui.report().events, [{type,
        at: instant,
        dataId: '17',
        error: {name: 'Error', message: 'Load failed'}}]);
    });

  test('unsafe dataId prevents metadata leaks', () => {
    const ui = setup();
    ui.api.capture(error('Load failed'), 'error', {dataid: 'PATIENT_SECRET'});
    const entry = ui.report().events[0];
    assert.deepEqual(entry.dataId === undefined ? {} : {dataId: entry.dataId},
      entry.dataId === undefined ? {} : {dataId: '[redacted]'});
  });

  test('event limit prevents unbounded history', () => {
    const ui = setup();
    for (let index = 0; index < 25; index++) {
      ui.api.capture(error(`Failure ${index}`), 'error');
    }
    const report = ui.report();
    assert.equal(report.events.length, 20);
    assert.equal(report.droppedEvents, 5);
    assert.deepEqual(report.events.map((entry) => Object.keys(entry).sort()),
      Array.from({length: 20}, () => ['at', 'error', 'type']));
  });

  test('abort and loadend prevent erasing an error', () => {
    const ui = setup();
    ui.api.capture(error('No DICOM file found in ZIP'), 'error');
    ui.service.dispatchEvent(new CustomEvent('abort', {detail: {dataid: '0'}}));
    ui.service.dispatchEvent(new CustomEvent('loadend', {
      detail: {dataid: '0'}
    }));
    assert.deepEqual(ui.report().events.filter((entry) => entry.error)
      .map((entry) => entry.error),
    [{name: 'Error', message: 'No DICOM file found in ZIP'}]);
  });

  test('copy success prevents premature feedback before clipboard resolves',
    async () => {
      let resolveCopy;
      const writeText = vi.fn(() => new Promise((resolve) => {
        resolveCopy = resolve;
      }));
      const ui = setup({writeText});
      ui.api.capture(error('Load failed'), 'error');
      const report = ui.textarea.value;
      ui.button.click();
      assert.deepEqual(writeText.mock.calls, [[report]]);
      assert.equal(ui.status.textContent, '');
      resolveCopy();
      await vi.waitFor(() => assert.equal(ui.status.textContent,
        'Diagnostics copied.'));
    });

  test.each(['missing', 'rejected'])(
    'clipboard %s preserves manual report access', async (mode) => {
      const clipboard = mode === 'missing' ? undefined : {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied'))
      };
      const ui = setup(clipboard);
      ui.api.capture(error('Load failed'), 'error');
      ui.button.click();
      await vi.waitFor(() => assert.equal(ui.status.textContent,
        'Copy unavailable. Report selected; use Copy.'));
      assert.isTrue(ui.details.open);
      assert.equal(document.activeElement, ui.textarea);
      assert.equal(ui.textarea.selectionStart, 0);
      assert.equal(ui.textarea.selectionEnd, ui.textarea.value.length);
    });

  test.each(['import', 'error'])(
    'new %s prevents old clipboard feedback surviving reset', async (kind) => {
      const ui = setup({writeText: vi.fn().mockResolvedValue(undefined)});
      ui.api.capture(error('Old failure'), 'error');
      ui.button.click();
      await vi.waitFor(() => assert.equal(ui.status.textContent,
        'Diagnostics copied.'));
      ui.details.open = true;
      if (kind === 'import') {
        ui.api.beginFiles([{name: 'new.zip', size: 2}], 'folder');
        assert.isFalse(ui.details.open);
        ui.api.capture(error('New failure'), 'error');
        assert.equal(ui.report().events.length, 1);
        assert.equal(ui.report().droppedEvents, 0);
      } else {
        ui.api.capture(error('New failure'), 'error');
        assert.equal(ui.report().events.length, 2);
      }
      assert.equal(ui.status.textContent, '');
    });

  test.each(['import', 'error'])(
    'pending clipboard promise prevents stale success after new %s',
    async (kind) => {
      let resolveCopy;
      const ui = setup({writeText: vi.fn(() => new Promise((resolve) => {
        resolveCopy = resolve;
      }))});
      ui.api.capture(error('Old failure'), 'error');
      ui.button.click();
      if (kind === 'import') {
        ui.api.beginFiles([], 'files');
      } else {
        ui.api.capture(error('New failure'), 'error');
      }
      resolveCopy();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(ui.status.textContent, '');
    });

  test('diagnostics prevents logs, uploads and persistent report storage',
    async () => {
      const consoleSpies = ['log', 'info', 'warn', 'error', 'debug']
        .map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
      const store = vi.spyOn(Storage.prototype, 'setItem');
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const ui = setup({writeText: vi.fn().mockRejectedValue(
        new Error('Clipboard unavailable'))});
      ui.api.capture(error('Load failed'), 'error');
      ui.button.click();
      await vi.waitFor(() => assert.equal(ui.status.textContent,
        'Copy unavailable. Report selected; use Copy.'));
      for (const spy of [...consoleSpies, store, fetch]) {
        assert.deepEqual(spy.mock.calls, []);
      }
    });
});
