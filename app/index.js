import {DwvAppService} from '../dev/viewer/src/dwvAppService.js';
import {ViewerUI} from '../dev/viewer/src/viewerUI.js';
import {getURLsFromKeyValueUri} from '../src/utils/uri.js';
import {setupInstall} from './install.js';
import {setupDiagnostics} from './diagnostics.js';
import {setupNavigation} from './navigation.js';

const service = new DwvAppService({debug: false});
service.registerListeners();
const viewer = new ViewerUI(service);
viewer.setup();
viewer.registerListeners();
setupNavigation(service, document);

const byId = (id) => document.getElementById(id);
const status = byId('load-status');
const progress = byId('loadprogress');
const cancel = byId('cancel-load');
const fileInput = byId('fileinput');
const folderInput = byId('folderinput');
const errorBox = byId('error');
const diagnostics = setupDiagnostics(service, document);
let pendingLoads = 0;
let hasLoadError = false;
let loadCancelled = false;

const showError = (message) => {
  byId('error-message').textContent = message;
  errorBox.hidden = false;
};

const loadFiles = (files, method) => {
  if (files.length === 0) {
    return;
  }
  diagnostics.beginFiles(files, method);
  try {
    service.loadFiles(Array.from(files));
  } catch (error) {
    diagnostics.capture(error, 'error');
    showError('These files could not be opened. ' +
      'Choose DICOM files, images or a ZIP archive.');
  }
};

for (const button of document.querySelectorAll('[data-open-files]')) {
  button.addEventListener('click', () => fileInput.click());
}
// ViewerUI owns the file-input change handler.
fileInput.addEventListener('change', () => {
  if (fileInput.files.length !== 0) {
    diagnostics.beginFiles(fileInput.files, 'files');
  }
}, {capture: true});
fileInput.addEventListener('click', () => {
  fileInput.value = '';
});
folderInput.addEventListener('change', () => {
  loadFiles(folderInput.files, 'folder');
  folderInput.value = '';
});
if ('webkitdirectory' in folderInput) {
  byId('open-folder').hidden = false;
  byId('open-folder').addEventListener('click', () => folderInput.click());
  byId('header-open-folder').addEventListener('click', () => {
    folderInput.click();
  });
}

const dropzone = byId('dropzone');
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('drag-over');
  loadFiles(event.dataTransfer.files, 'drop');
});
byId('dismiss-error').addEventListener('click', () => {
  errorBox.hidden = true;
});
cancel.addEventListener('click', () => {
  loadCancelled = true;
  service.abortAllLoads();
  status.textContent = 'Loading cancelled. You can open files again.';
});

service.addEventListener('loadstart', () => {
  if (pendingLoads === 0) {
    hasLoadError = false;
    loadCancelled = false;
    errorBox.hidden = true;
  }
  pendingLoads++;
  progress.hidden = false;
  cancel.hidden = false;
  status.textContent = 'Opening scans…';
});
service.addEventListener('loadprogress', () => {
  status.textContent = `Opening scans · ${service.getLoadProgress()}%`;
});
service.addEventListener('renderend', () => {
  byId('empty-state').hidden = true;
  byId('study-empty').hidden = true;
  byId('extra').disabled = false;
  byId('header-open-folder').hidden = !('webkitdirectory' in folderInput);
});
service.addEventListener('loadend', () => {
  pendingLoads = Math.max(0, pendingLoads - 1);
  if (pendingLoads === 0) {
    progress.hidden = true;
    cancel.hidden = true;
    const count = service.getDataController().getDataIds().length;
    status.textContent = loadCancelled ? 'Loading cancelled.'
      : hasLoadError ? 'Some files could not be opened.'
        : `${count} ${count === 1 ? 'dataset' : 'datasets'} open` +
          ' · Files stay on this device';
  }
});
const reportLoadError = () => {
  hasLoadError = true;
  status.textContent = 'Some files could not be opened.';
  showError('A scan could not be opened. ' +
    'Check that all files in the series are selected ' +
    'and that the file is supported. ' +
    'You can copy technical details below.');
};
service.addEventListener('error', reportLoadError);
service.addEventListener('timeout', reportLoadError);

const layout = byId('changelayout');
const layoutNames = {
  '1*1': 'Single view',
  '1*2': 'Side by side',
  mpr: 'Three planes (MPR)'
};
for (const option of layout.options) {
  option.textContent = layoutNames[option.value] ?? option.value;
}
layout.addEventListener('change', () => {
  byId('dwv').dataset.layout = layout.value;
  service.getStageController().fitToContainer();
});
const toolNames = {
  WindowLevel: 'Contrast',
  ZoomAndPan: 'Zoom / pan',
  Floodfill: 'Flood fill'
};
for (const button of document.querySelectorAll('button[name=tools]')) {
  button.textContent = toolNames[button.title] ?? button.title;
}

const studyPanel = byId('study-panel');
studyPanel.open = !matchMedia('(max-width: 1023px)').matches;
const undoController = service.getUndoController();
const refreshHistory = () => {
  byId('undo').disabled = undoController.getCurrentStackIndex() === 0;
  byId('redo').disabled = undoController.getCurrentStackIndex() ===
    undoController.getStackSize();
};
byId('undo').addEventListener('click', () => undoController.undo());
byId('redo').addEventListener('click', () => undoController.redo());
for (const event of ['undoadd', 'undoremove', 'undo', 'redo']) {
  undoController.addEventListener(event, () => queueMicrotask(refreshHistory));
}
new ResizeObserver(() => {
  service.getStageController().fitToContainer();
}).observe(byId('dwv'));

for (const slider of document.querySelectorAll('.vertical-slider')) {
  slider.setAttribute('aria-label', 'Slice position');
}
new MutationObserver(() => {
  for (const slider of document.querySelectorAll('.vertical-slider')) {
    slider.setAttribute('aria-label', 'Slice position');
  }
}).observe(byId('dwv'), {childList: true});

const labelStudyControls = () => {
  const table = byId('layerstable');
  if (!table) {
    return;
  }
  const headings = Array.from(table.tHead.rows[0].cells,
    (cell) => cell.textContent);
  const names = {
    Id: 'Dataset',
    Preset: 'Window preset & colour map',
    Alpha: 'Opacity',
    'Alpha Range': 'Opacity range'
  };
  for (const row of table.tBodies[0].rows) {
    Array.from(row.cells).forEach((cell, index) => {
      const heading = headings[index];
      cell.dataset.label = names[heading] ??
        (heading.startsWith('LG')
          ? `View ${Number(heading.slice(2)) + 1}` : heading);
      for (const control of cell.querySelectorAll('button, input')) {
        if (control.title) {
          control.setAttribute('aria-label', control.title);
        } else if (control.type === 'radio') {
          control.setAttribute('aria-label',
            `Select dataset ${row.id.slice(5)} in ${cell.dataset.label}`);
        } else if (control.type === 'number') {
          const label = byId(control.id.replace(/-number$/, '-label'));
          if (label) {
            control.setAttribute('aria-label', label.textContent);
          }
        }
      }
    });
  }
};
new MutationObserver(labelStudyControls)
  .observe(byId('layersdetails'), {childList: true, subtree: true});

setupInstall();
const urls = getURLsFromKeyValueUri(window.location.href);
if (typeof urls !== 'undefined') {
  diagnostics.beginURLs(urls);
  try {
    service.loadURLs(urls);
  } catch (error) {
    diagnostics.capture(error, 'error');
    reportLoadError();
  }
}
