import {getDwvVersion} from '../src/dicom/dicomParser.js';

const extensions = new Set([
  'zip',
  'dcm',
  'dicom',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'mp4',
  'avi',
  'pdf'
]);

/**
 * Collect a bounded, memory-only report at the viewer load boundary.
 *
 * @param {EventTarget} service Viewer event source.
 * @param {Document} rootDocument Report controls' document.
 * @param {object} [options] Diagnostic options.
 * @param {Function} [options.now] ISO timestamp provider.
 * @returns {object} Import boundary and synchronous error handlers.
 */
export function setupDiagnostics(service, rootDocument, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const browser = rootDocument.defaultView;
  const navigator = browser.navigator;
  const details = rootDocument.getElementById('error-diagnostics');
  const textarea = rootDocument.getElementById('diagnostic-report');
  const button = rootDocument.getElementById('copy-diagnostics');
  const status = rootDocument.getElementById('copy-status');
  const bundle = Array.from(rootDocument.scripts, (script) =>
    new URL(script.src, rootDocument.baseURI).pathname.split('/').pop())
    .find((name) => /^app\.[a-f0-9]+\.js$/i.test(name)) ?? 'unknown';
  let sources = new Set();
  let revision = 0;
  let report;

  const rememberSource = (source) => {
    if (typeof source === 'string' && source.length !== 0) {
      sources.add(source);
    } else if (source && typeof source === 'object') {
      for (const key of ['name', 'filename', 'webkitRelativePath']) {
        if (typeof source[key] === 'string' && source[key].length !== 0) {
          sources.add(source[key]);
        }
      }
    }
  };
  const redact = (value) => {
    let text = String(value);
    // Keep app bundle line numbers without exposing hosts, queries or paths.
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi, (url) => {
      const location = url.match(/\/(app\.[a-f0-9]+\.js)(:\d+(?::\d+)?)?$/i);
      return location ? location[1] + (location[2] ?? '') : '[url]';
    });
    for (const source of Array.from(sources).sort((a, b) =>
      b.length - a.length)) {
      text = text.split(source).join('[redacted]');
    }
    return text
      .replace(/"[^"\n]*"|'[^'\n]*'/g, '[redacted]')
      .replace(/(?:[a-z]:\\|\/)[^\s)\],;]+/gi, '[redacted]')
      .replace(/\b[^\s/\\:()]+\.(?:zip|dcm|dicom|png|jpe?g|mp4|avi)\b/gi,
        '[redacted]')
      .slice(0, 8000);
  };
  const describeArchive = (value) => {
    const archive = {};
    for (const key of ['fileCount',
      'directoryCount',
      'ignoredFileCount',
      'dicomFileCount',
      'skippedFileCount']) {
      if (Number.isSafeInteger(value[key]) && value[key] >= 0) {
        archive[key] = value[key];
      }
    }
    if (Array.isArray(value.types)) {
      archive.types = value.types.filter((entry) => entry &&
        (extensions.has(entry.extension) ||
          ['none', 'other'].includes(entry.extension)) &&
          Number.isSafeInteger(entry.count) && entry.count >= 0)
        .slice(0, 20)
        .map(({extension, count}) => ({extension, count}))
        .sort((a, b) => a.extension.localeCompare(b.extension));
    }
    return archive;
  };
  const describeOutput = () => {
    const controller = service.getDataController?.();
    if (!controller) {
      return;
    }
    const output = [];
    for (const dataId of controller.getDataIds().slice(0, 128)) {
      if (!/^\d+$/.test(String(dataId))) {
        continue;
      }
      const data = controller.get(dataId);
      const dimensions = data?.image?.getGeometry().getSize().getValues();
      if (!Array.isArray(dimensions) || dimensions.length === 0 ||
        dimensions.length > 8 || dimensions.some((value) =>
        !Number.isSafeInteger(value) || value <= 0)) {
        continue;
      }
      const item = {dataId: String(dataId), dimensions: dimensions.slice()};
      const complete = data.getComplete?.();
      if (typeof complete === 'boolean') {
        item.complete = complete;
      }
      output.push(item);
    }
    return output;
  };
  const describeError = (error, depth = 0) => {
    const name = typeof error?.name === 'string' &&
      /^[A-Za-z]{1,40}Error$|^Error$/.test(error.name)
      ? error.name : 'Error';
    const result = {
      name,
      message: redact(error?.message ?? error ?? 'No error detail supplied')
    };
    if (typeof error?.stack === 'string') {
      result.stack = redact(error.stack);
    }
    if (error?.archive && typeof error.archive === 'object') {
      result.archive = describeArchive(error.archive);
    }
    if (depth < 3 && typeof error?.cause !== 'undefined') {
      result.cause = describeError(error.cause, depth + 1);
    }
    return result;
  };
  const refresh = () => {
    revision++;
    status.textContent = '';
    textarea.value = JSON.stringify(report, null, 2);
  };
  const begin = (input) => {
    const standalone = browser.matchMedia?.('(display-mode: standalone)')
      .matches || navigator.standalone;
    report = {
      schema: 1,
      app: {version: getDwvVersion(), bundle},
      environment: {
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        displayMode: standalone ? 'standalone' : 'browser'
      },
      input,
      events: [],
      droppedEvents: 0
    };
    details.open = false;
    refresh();
  };
  const beginFiles = (files, method) => {
    sources = new Set();
    const types = new Map();
    let totalBytes = 0;
    for (const file of files) {
      rememberSource(file);
      totalBytes += file.size ?? 0;
      const suffix = file.name?.match(/[^.]\.([^.]+)$/)?.[1].toLowerCase();
      const extension = typeof suffix === 'undefined' ? 'none'
        : extensions.has(suffix) ? suffix : 'other';
      types.set(extension, (types.get(extension) ?? 0) + 1);
    }
    begin({
      method: ['files', 'folder', 'drop'].includes(method) ? method : 'files',
      fileCount: files.length,
      totalBytes,
      types: Array.from(types, ([extension, count]) => ({extension, count}))
        .sort((a, b) => a.extension.localeCompare(b.extension))
    });
  };
  const beginURLs = (urls) => {
    sources = new Set();
    urls.forEach(rememberSource);
    begin({method: 'url', fileCount: urls.length, totalBytes: 0, types: []});
  };
  const capture = (error, type, detail = {}) => {
    detail ??= {};
    rememberSource(detail.source);
    const entry = {type, at: now()};
    if (/^\d+$/.test(String(detail.dataid))) {
      entry.dataId = String(detail.dataid);
    }
    if (typeof error !== 'undefined') {
      entry.error = describeError(error);
    }
    if (type === 'loadend') {
      if (detail.archive && typeof detail.archive === 'object') {
        entry.archive = describeArchive(detail.archive);
      }
      const output = describeOutput();
      if (typeof output !== 'undefined') {
        entry.output = output;
      }
    }
    report.events.push(entry);
    if (report.events.length > 20) {
      const lifecycle = report.events.findIndex((event) => !event.error);
      report.events.splice(Math.max(0, lifecycle), 1);
      report.droppedEvents++;
    }
    refresh();
  };
  begin({method: 'none', fileCount: 0, totalBytes: 0, types: []});
  for (const type of ['error', 'timeout']) {
    service.addEventListener(type, (event) => {
      const detail = event.detail ?? {};
      capture(detail.error ?? detail.target?.error ??
        new Error(type === 'timeout' ? 'Load timed out'
          : 'Load failed without error detail'), type, detail);
    });
  }
  for (const type of ['loadstart', 'abort', 'loadend']) {
    service.addEventListener(type, (event) => {
      capture(undefined, type, event.detail);
    });
  }
  button.addEventListener('click', async () => {
    const copiedRevision = revision;
    try {
      await navigator.clipboard.writeText(textarea.value);
      if (revision === copiedRevision) {
        status.textContent = 'Diagnostics copied.';
      }
    } catch {
      if (revision === copiedRevision) {
        details.open = true;
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        status.textContent = 'Copy unavailable. Report selected; use Copy.';
      }
    }
  });
  return {beginFiles, beginURLs, capture};
}
