import {fileContentTypes} from './filesLoader.js';
import {urlContentTypes} from './urlsLoader.js';
import {MemoryLoader} from './memoryLoader.js';
import {LoaderBase} from './loaderBase.js';
import {hasDicomPrefix} from '../dicom/dicomParser.js';

/**
 * The zip library.
 *
 * Ref: {@link https://github.com/Stuk/jszip}.
 *
 * @external JSZip
 */
import JSZip from 'jszip';

/**
 * ZIP data loader.
 */
export class ZipLoader extends LoaderBase {

  /**
   * Active archive loads, including extraction and memory loading.
   *
   * @type {Set<object>}
   */
  #loads = new Set();

  /**
   * Complete one load without accepting later asynchronous callbacks.
   *
   * @param {object} load Archive load context.
   * @param {object} event Completion event.
   * @param {Error} [error] Extraction error.
   */
  #finish(load, event, error) {
    if (!load.active) {
      return;
    }
    load.active = false;
    this.#loads.delete(load);
    this.setLoading(this.#loads.size !== 0);
    if (typeof error !== 'undefined') {
      this.onerror({error});
    }
    this.onloadend(event);
  }

  /**
   * Read archive entries sequentially to avoid parallel decompression buffers.
   *
   * @param {object} load Archive load context.
   * @param {number} position Entry index.
   * @returns {Promise|undefined} Extraction completion.
   */
  #readEntry(load, position) {
    if (!load.active) {
      return;
    }
    if (position === load.entries.length) {
      if (load.files.length === 0) {
        throw Object.assign(new Error('No DICOM file found in ZIP'), {
          archive: {...load.archive, dicomFileCount: 0}
        });
      }
      this.#loadBuffers(load);
      return;
    }
    const entry = load.entries[position];
    return entry.async('arrayBuffer').then((content) => {
      if (!load.active) {
        return;
      }
      if (/\.(dcm|dicom)$/i.test(entry.name) || hasDicomPrefix(content)) {
        load.files.push({filename: entry.name,
          'Content-Type': 'application/dicom',
          data: content});
      }
      const percent = (position + 1) * 100 / load.entries.length;
      this.onprogress({
        lengthComputable: true,
        loaded: percent / 2,
        total: 100,
        index: load.index,
        item: {loaded: percent, total: 100, source: load.origin}
      });
      return this.#readEntry(load, position + 1);
    });
  }

  /**
   * Pass discovered images to the existing DICOM memory loader.
   *
   * @param {object} load Archive load context.
   */
  #loadBuffers(load) {
    const memoryIO = new MemoryLoader();
    load.memoryIO = memoryIO;
    memoryIO.setDefaultCharacterSet(this.getOptions().defaultCharacterSet);
    memoryIO.onprogress = (progress) => {
      if (load.active) {
        progress.loaded = 50 + progress.loaded / 2;
        progress.index = load.index;
        this.onprogress(progress);
      }
    };
    for (const type of ['loaditem', 'load', 'error', 'abort']) {
      memoryIO[`on${type}`] = (event) => {
        if (load.active) {
          this[`on${type}`](event);
        }
      };
    }
    memoryIO.onloadend = (event) => this.#finish(load, event);
    memoryIO.load(load.files);
  }

  /**
   * Load data.
   *
   * @param {object} buffer The DICOM buffer.
   * @param {string} origin The data origin.
   * @param {number} index The data index.
   */
  load(buffer, origin, index) {
    const load = {active: true, entries: [], files: [], origin, index};
    this.#loads.add(load);
    this.setLoading(true);
    // send start event
    this.onloadstart({
      source: origin
    });
    JSZip.loadAsync(buffer).then((zip) => {
      if (!load.active) {
        return;
      }
      const entries = Object.values(zip.files);
      const files = entries.filter((entry) => !entry.dir);
      const types = new Map();
      const safeExtensions = new Set(['zip',
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
        'pdf']);
      for (const entry of files) {
        const name = entry.name.split('/').pop();
        const suffix = name.match(/[^.]\.([^.]+)$/)?.[1].toLowerCase();
        const extension = typeof suffix === 'undefined' ? 'none'
          : safeExtensions.has(suffix) ? suffix : 'other';
        types.set(extension, (types.get(extension) ?? 0) + 1);
        if (name.toUpperCase() !== 'DICOMDIR' && !name.startsWith('._') &&
          !entry.name.split('/').includes('__MACOSX')) {
          load.entries.push(entry);
        }
      }
      load.archive = {
        fileCount: files.length,
        directoryCount: entries.length - files.length,
        ignoredFileCount: files.length - load.entries.length,
        types: Array.from(types, ([extension, count]) => ({extension, count}))
          .sort((a, b) => a.extension.localeCompare(b.extension))
      };
      return this.#readEntry(load, 0);
    }).catch((err) => {
      this.#finish(load, {}, err);
    });
  }

  /**
   * Abort load: pass to listeners.
   */
  abort() {
    for (const load of Array.from(this.#loads)) {
      load.active = false;
      this.#loads.delete(load);
      this.setLoading(this.#loads.size !== 0);
      load.memoryIO?.abort();
      this.onabort({});
      this.onloadend({});
    }
  }

  /**
   * Check if the loader supports the input extension.
   *
   * @param {string} value The extensione.
   * @returns {boolean} True if it can be loaded.
   */
  canLoadExtension(value) {
    return value === 'zip';
  }

  /**
   * Check if the input is the loader name.
   *
   * @param {string} value The test name.
   * @returns {boolean} True if input is the loader name.
   */
  isLoaderName(value) {
    return value === 'zip';
  }

  /**
   * Check if the loader supports the input media type.
   *
   * @param {string} value The media type.
   * @returns {boolean} True if it can be loaded.
   */
  canLoadMediaType(value) {
    return value === 'application/zip';
  }

  /**
   * Get the file content type needed by the loader.
   *
   * @returns {number} One of the 'fileContentTypes'.
   */
  loadFileAs() {
    return fileContentTypes.ArrayBuffer;
  }

  /**
   * Get the url content type needed by the loader.
   *
   * @returns {number} One of the 'urlContentTypes'.
   */
  loadUrlAs() {
    return urlContentTypes.ArrayBuffer;
  }

} // class ZipLoader
