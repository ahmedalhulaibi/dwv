// @vitest-environment jsdom
import {afterEach, assert, test, vi} from 'vitest';
import {setupNavigation} from '../../app/navigation.js';
import {PositionHelper} from '../../src/image/positionHelper.js';
import {Geometry} from '../../src/image/geometry.js';
import {Size} from '../../src/image/size.js';
import {Spacing} from '../../src/image/spacing.js';
import {Index} from '../../src/math/index.js';
import {Point3D} from '../../src/math/point.js';

/**
 * Build a view position boundary backed by real world/index conversion.
 *
 * @param {object} config Geometry, initial index and optional scroll dimension.
 * @param {string} id Pane element id.
 * @param {EventTarget} service Viewer event source.
 * @returns {object} Pane boundary and test observation methods.
 */
function makePane(config, id, service) {
  const {size, index, scroll = 2} = config;
  const origins = Array.from({length: size[2]}, (_, z) =>
    new Point3D(10, -20, 30 + z * 5));
  const geometry = new Geometry(origins, new Size(size.slice(0, 3)),
    new Spacing([2, 3, 5]), undefined,
    size.length === 4 ? {id: {value: 0}} : undefined);
  for (let time = 1; time < (size[3] ?? 1); time++) {
    geometry.appendFrame(origins[0], {id: {value: time}});
    for (let z = 1; z < origins.length; z++) {
      geometry.appendOrigin(origins[z], z, time);
    }
  }
  let position = geometry.indexToWorld(new Index(index));
  const setPosition = vi.fn((next) => {
    position = next;
    service.dispatchEvent(new CustomEvent('positionchange'));
    return true;
  });
  const view = {
    getImage: () => ({getGeometry: () => geometry}),
    getCurrentPosition: () => position,
    getScrollDimIndex: () => scroll,
    setCurrentPosition: setPosition
  };
  const helper = new PositionHelper(view);
  return {
    getDivId: () => id,
    getPositionHelper: () => helper,
    getActiveViewLayer: () => ({getViewController: () => ({
      getPositionHelper: () => helper
    })}),
    helper,
    setPosition,
    jump: (values) => {
      position = geometry.indexToWorld(new Index(values));
    }
  };
}

/**
 * Connect navigation to a minimal real-shaped viewer service.
 *
 * @param {object[]} configs Pane geometry configurations.
 * @returns {object} Navigation controls and mutable viewer boundary.
 */
function setup(configs = []) {
  document.body.innerHTML = '<div id="dwv"></div>' +
    '<select id="changelayout"><option>Single</option></select>' +
    '<section id="image-navigation"><button id="previous-image">Previous' +
    '</button><span id="image-counter"></span>' +
    '<button id="next-image">Next</button>' +
    '<input id="image-range" type="range" aria-label="Image">' +
    '<select id="navigation-view"></select></section>';
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  const service = new EventTarget();
  let panes = [];
  let active;
  const stage = {
    getNumberOfLayerGroups: () => panes.length,
    getLayerGroup: (index) => panes[index],
    getActiveLayerGroup: () => panes[active],
    setActiveLayerGroup: vi.fn((index) => {
      active = index;
    })
  };
  service.getStageController = () => stage;
  const replace = (nextConfigs) => {
    panes = nextConfigs.map((config, index) =>
      makePane(config, `layerGroup${index}`, service));
    active = panes.length === 0 ? undefined : 0;
    const elements = panes.map((pane, index) => {
      const element = document.createElement('div');
      element.id = pane.getDivId();
      element.className = 'layerGroup';
      element.addEventListener('pointerdown', () => {
        stage.setActiveLayerGroup(index);
      });
      return element;
    });
    document.getElementById('dwv').replaceChildren(...elements);
  };
  replace(configs);
  setupNavigation(service, document);
  return {
    service,
    stage,
    replace,
    panes: () => panes,
    previous: document.getElementById('previous-image'),
    next: document.getElementById('next-image'),
    counter: document.getElementById('image-counter'),
    range: document.getElementById('image-range'),
    selector: document.getElementById('navigation-view')
  };
}

/**
 * Wait for user-visible state and check its accessible range text.
 *
 * @param {object} ui Navigation fixture.
 * @param {string} text Expected counter.
 */
async function counter(ui, text) {
  await vi.waitFor(() => assert.equal(ui.counter.textContent, text));
  assert.equal(ui.range.getAttribute('aria-valuetext'), text);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test.each([
  [[], 'No images open'],
  [[{size: [4, 5, 1], index: [1, 2, 0]}], 'Image 1 of 1']
])('empty or single-image view prevents unusable navigation: %s',
  async (panes, text) => {
    const ui = setup(panes);
    await counter(ui, text);
    assert.equal(ui.previous.disabled, true);
    assert.equal(ui.next.disabled, true);
    assert.equal(ui.range.disabled, true);
    assert.equal(ui.selector.hidden, true);
  });

test.each([
  {name: 'spatial stack',
    size: [4, 5, 3],
    index: [1, 2, 0],
    next: [1, 2, 1],
    last: [1, 2, 2],
    first: [1, 2, 0],
    total: 3,
    initial: 'Image 1 of 3',
    advanced: 'Image 2 of 3'},
  {name: 'time-only ultrasound',
    size: [4, 5, 1, 3],
    index: [1, 2, 0, 0],
    next: [1, 2, 0, 1],
    last: [1, 2, 0, 2],
    first: [1, 2, 0, 0],
    total: 3,
    initial: 'Image 1 of 3',
    advanced: 'Image 2 of 3'},
  {name: 'spatial and time carry',
    size: [4, 5, 2, 3],
    index: [1, 2, 1, 0],
    next: [1, 2, 0, 1],
    last: [1, 2, 1, 2],
    first: [1, 2, 0, 0],
    total: 6,
    initial: 'Image 2 of 6',
    advanced: 'Image 3 of 6'},
  {name: 'non-Z scroll dimension',
    size: [3, 5, 2, 2],
    index: [0, 2, 1, 0],
    scroll: 0,
    next: [1, 2, 1, 0],
    last: [2, 2, 1, 1],
    first: [0, 2, 1, 0],
    total: 6,
    initial: 'Image 1 of 6',
    advanced: 'Image 2 of 6'}
])('$name prevents missed images or coordinate loss', async (row) => {
  const ui = setup([row]);
  const pane = ui.panes()[0];
  await counter(ui, row.initial);
  assert.equal(ui.range.min, '1');
  assert.equal(ui.range.max, String(row.total));
  ui.next.click();
  await counter(ui, row.advanced);
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.next);
  ui.previous.click();
  await counter(ui, row.initial);
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.index);
  ui.range.value = String(row.total);
  ui.range.dispatchEvent(new Event('input', {bubbles: true}));
  await counter(ui, `Image ${row.total} of ${row.total}`);
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.last);
  assert.equal(ui.next.disabled, true);
  ui.next.click();
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.last);
  ui.range.value = '1';
  ui.range.dispatchEvent(new Event('input', {bubbles: true}));
  await counter(ui, `Image 1 of ${row.total}`);
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.first);
  assert.equal(ui.previous.disabled, true);
  ui.previous.click();
  assert.deepEqual(pane.helper.getCurrentIndex().getValues(), row.first);
});

test.each(['renderend',
  'positionchange',
  'load',
  'loadend',
  'viewlayeradd',
  'layerremove',
  'activelayerchange'])(
  '%s prevents a stale counter', async (type) => {
    const ui = setup([{size: [4, 5, 3], index: [1, 2, 0]}]);
    await counter(ui, 'Image 1 of 3');
    ui.panes()[0].jump([1, 2, 2]);
    ui.service.dispatchEvent(new CustomEvent(type));
    await counter(ui, 'Image 3 of 3');
    assert.equal(ui.range.value, '3');
    assert.equal(ui.next.disabled, true);
  });

test('pane selector and pane touch prevent navigating the wrong image view',
  async () => {
    const ui = setup([
      {size: [4, 5, 3], index: [1, 2, 0]},
      {size: [4, 5, 4], index: [1, 2, 1]}
    ]);
    await counter(ui, 'Image 1 of 3');
    assert.equal(ui.selector.hidden, false);
    assert.deepEqual(Array.from(ui.selector.options, (option) => option.text),
      ['View 1', 'View 2']);
    ui.selector.value = ui.selector.options[1].value;
    ui.selector.dispatchEvent(new Event('change', {bubbles: true}));
    await counter(ui, 'Image 2 of 4');
    assert.equal(ui.stage.getActiveLayerGroup(), ui.panes()[1]);
    ui.next.click();
    await counter(ui, 'Image 3 of 4');
    assert.deepEqual(ui.panes()[1].helper.getCurrentIndex().getValues(),
      [1, 2, 2]);
    assert.deepEqual(ui.panes()[0].helper.getCurrentIndex().getValues(),
      [1, 2, 0]);
    document.getElementById('layerGroup0').dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true}));
    await counter(ui, 'Image 1 of 3');
    assert.equal(ui.selector.value, ui.selector.options[0].value);
  });

test('reset and new import prevent stale pane callbacks', async () => {
  const ui = setup([{size: [4, 5, 3], index: [1, 2, 2]}]);
  const previousPane = ui.panes()[0];
  await counter(ui, 'Image 3 of 3');
  ui.replace([]);
  ui.service.dispatchEvent(new CustomEvent('layerremove'));
  await counter(ui, 'No images open');
  ui.next.click();
  ui.previous.click();
  assert.deepEqual(previousPane.setPosition.mock.calls, []);
  ui.replace([{size: [4, 5, 1], index: [1, 2, 0]}]);
  ui.service.dispatchEvent(new CustomEvent('renderend'));
  await counter(ui, 'Image 1 of 1');
  assert.equal(ui.range.max, '1');
  assert.equal(ui.range.disabled, true);
});

test('layout change refreshes after existing pane replacement handler',
  async () => {
    const ui = setup([{size: [4, 5, 3], index: [1, 2, 0]}]);
    const layout = document.getElementById('changelayout');
    layout.addEventListener('change', () => {
      ui.replace([{size: [4, 5, 1, 4], index: [1, 2, 0, 2]}]);
    });
    layout.dispatchEvent(new Event('change', {bubbles: true}));
    await counter(ui, 'Image 3 of 4');
    assert.equal(ui.range.max, '4');
  });
