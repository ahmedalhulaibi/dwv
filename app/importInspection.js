import {safeGet} from '../src/dicom/dataElement.js';
import {hasAnyPixelDataElement} from '../src/dicom/dicomTag.js';

const imageTypes = new Map([
  ['1.2.840.10008.5.1.4.1.1.6.1', 'ultrasound'],
  ['1.2.840.10008.5.1.4.1.1.3.1', 'ultrasound-multiframe'],
  ['1.2.840.10008.5.1.4.1.1.7', 'secondary-capture']
]);

/**
 * Read a positive integer without copying arbitrary metadata into a report.
 *
 * @param {*} value Header value.
 * @returns {number|undefined} Valid integer.
 */
function positiveInteger(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/**
 * Aggregate accepted parsed files without retaining their metadata or pixels.
 */
export class ImportInspection {
  #seen = new WeakSet();
  #instances = new Set();
  #studies = new Set();
  #series = new Set();
  #groups = new Map();
  #counts = {
    fileCount: 0,
    imageFileCount: 0,
    documentFileCount: 0,
    otherFileCount: 0,
    duplicateInstanceCount: 0,
    missingInstanceIdCount: 0
  };

  /**
   * Observe a load item. Frames of the same file share one metadata object.
   *
   * @param {object} data Parsed load item.
   */
  add(data) {
    const meta = data?.meta;
    if (!meta || typeof meta !== 'object' || this.#seen.has(meta)) {
      return;
    }
    this.#seen.add(meta);
    const readId = (key) => {
      const value = safeGet(meta, key);
      return typeof value === 'string' && value.length !== 0
        ? value : undefined;
    };
    const instance = readId('00080018');
    const study = readId('0020000D');
    const series = readId('0020000E');
    const sopClass = readId('00080016');
    const image = hasAnyPixelDataElement(meta);
    const document = !image && sopClass === '1.2.840.10008.5.1.4.1.1.104.1';
    const type = image ? imageTypes.get(sopClass) ?? 'other-image'
      : document ? 'encapsulated-pdf' : 'other';
    this.#counts.fileCount++;
    this.#counts[image ? 'imageFileCount'
      : document ? 'documentFileCount' : 'otherFileCount']++;
    if (typeof instance === 'undefined') {
      this.#counts.missingInstanceIdCount++;
    } else {
      if (this.#instances.has(instance)) {
        this.#counts.duplicateInstanceCount++;
      }
      this.#instances.add(instance);
    }
    if (typeof study !== 'undefined') {
      this.#studies.add(study);
    }
    if (typeof series !== 'undefined') {
      this.#series.add(series);
    }
    const key = JSON.stringify([study, series, sopClass]);
    let group = this.#groups.get(key);
    if (!group) {
      group = {
        group: this.#groups.size + 1,
        type,
        fileCount: 0,
        instances: new Set(),
        duplicateInstanceCount: 0,
        positionTagCount: 0,
        orientationTagCount: 0,
        multiFrameFileCount: 0,
        dimensions: new Map()
      };
      this.#groups.set(key, group);
    }
    group.fileCount++;
    if (typeof instance !== 'undefined') {
      if (group.instances.has(instance)) {
        group.duplicateInstanceCount++;
      }
      group.instances.add(instance);
    }
    group.positionTagCount +=
      typeof meta['00200032'] !== 'undefined' ? 1 : 0;
    group.orientationTagCount +=
      typeof meta['00200037'] !== 'undefined' ? 1 : 0;
    const rawFrames = safeGet(meta, '00280008');
    const frames = typeof rawFrames === 'undefined'
      ? 1 : positiveInteger(rawFrames);
    if (frames > 1) {
      group.multiFrameFileCount++;
    }
    const columns = positiveInteger(safeGet(meta, '00280011'));
    const rows = positiveInteger(safeGet(meta, '00280010'));
    if (image && columns && rows && frames) {
      const dimensionKey = JSON.stringify([columns, rows, frames]);
      const dimension = group.dimensions.get(dimensionKey);
      if (dimension) {
        dimension.count++;
      } else {
        group.dimensions.set(dimensionKey, {columns, rows, frames, count: 1});
      }
    }
  }

  /**
   * Return only bounded counts, known categories and numeric image properties.
   *
   * @returns {object} Shareable aggregate inspection.
   */
  getSummary() {
    return {
      ...this.#counts,
      uniqueInstanceCount: this.#instances.size,
      studyCount: this.#studies.size,
      seriesCount: this.#series.size,
      groupCount: this.#groups.size,
      groups: Array.from(this.#groups.values()).slice(0, 128).map((group) => ({
        group: group.group,
        type: group.type,
        fileCount: group.fileCount,
        uniqueInstanceCount: group.instances.size,
        duplicateInstanceCount: group.duplicateInstanceCount,
        positionTagCount: group.positionTagCount,
        orientationTagCount: group.orientationTagCount,
        multiFrameFileCount: group.multiFrameFileCount,
        dimensions: Array.from(group.dimensions.values()).slice(0, 16)
          .map((dimension) => ({...dimension})),
        omittedDimensionCount: Math.max(0, group.dimensions.size - 16)
      })),
      omittedGroupCount: Math.max(0, this.#groups.size - 128)
    };
  }
}
