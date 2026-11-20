import {Index} from '../src/math/index.js';

/**
 * Connect visible image navigation to the existing view position controller.
 *
 * @param {object} service Viewer service.
 * @param {Document} rootDocument Navigation controls' document.
 */
export function setupNavigation(service, rootDocument) {
  const previous = rootDocument.getElementById('previous-image');
  const next = rootDocument.getElementById('next-image');
  const counter = rootDocument.getElementById('image-counter');
  const range = rootDocument.getElementById('image-range');
  const selector = rootDocument.getElementById('navigation-view');
  const workspace = rootDocument.getElementById('dwv');
  const stage = service.getStageController();

  const getPanes = () => {
    const panes = [];
    for (let index = 0; index < stage.getNumberOfLayerGroups(); index++) {
      const group = stage.getLayerGroup(index);
      const helper = group?.getPositionHelper();
      if (helper) {
        panes.push({group, helper, index});
      }
    }
    return panes;
  };
  const getState = () => {
    const panes = getPanes();
    const active = panes.find((pane) =>
      pane.group === stage.getActiveLayerGroup()) ?? panes[0];
    if (!active) {
      return {panes, total: 0, current: 0};
    }
    const {helper} = active;
    const size = helper.getGeometry().getSize().getValues();
    const values = helper.getCurrentIndex().getValues();
    const axes = [helper.getScrollDimIndex(),
      ...size.map((_, index) => index).filter((index) => index >= 3)];
    let total = 1;
    let current = 0;
    for (const axis of axes) {
      current += values[axis] * total;
      total *= size[axis];
    }
    return {panes, active, axes, values, size, total, current};
  };
  const refresh = () => {
    const state = getState();
    const {panes, active, total, current} = state;
    const text = total === 0 ? 'No images open'
      : `Image ${current + 1} of ${total}`;
    if (counter.textContent !== text) {
      counter.textContent = text;
    }
    range.min = '1';
    range.max = String(Math.max(1, total));
    range.value = String(current + 1);
    range.disabled = total <= 1;
    range.setAttribute('aria-valuetext', text);
    previous.disabled = total <= 1 || current === 0;
    next.disabled = total <= 1 || current === total - 1;
    selector.hidden = panes.length <= 1;
    if (selector.options.length !== panes.length ||
      panes.some((pane, index) =>
        selector.options[index].value !== String(pane.index))) {
      selector.replaceChildren(...panes.map((pane) => {
        const option = rootDocument.createElement('option');
        option.value = String(pane.index);
        option.textContent = `View ${pane.index + 1}`;
        return option;
      }));
    }
    if (active) {
      selector.value = String(active.index);
    }
  };
  const goTo = (value) => {
    const state = getState();
    if (!state.active || !Number.isFinite(value)) {
      return;
    }
    let remaining = Math.max(0, Math.min(state.total - 1, Math.trunc(value)));
    const values = state.values.slice();
    for (const axis of state.axes) {
      values[axis] = remaining % state.size[axis];
      remaining = Math.floor(remaining / state.size[axis]);
    }
    stage.setActiveLayerGroup(state.active.index);
    const helper = state.active.helper;
    helper.setCurrentPosition(helper.getGeometry().indexToWorld(
      new Index(values)));
    refresh();
  };
  previous.addEventListener('click', () => goTo(getState().current - 1));
  next.addEventListener('click', () => goTo(getState().current + 1));
  range.addEventListener('input', () => goTo(Number(range.value) - 1));
  selector.addEventListener('change', () => {
    const pane = getPanes().find((item) =>
      item.index === Number(selector.value));
    if (pane) {
      stage.setActiveLayerGroup(pane.index);
      refresh();
    }
  });
  for (const type of ['renderend',
    'positionchange',
    'load',
    'loadend',
    'viewlayeradd',
    'layerremove',
    'activelayerchange']) {
    service.addEventListener(type, refresh);
  }
  const scheduleRefresh = () => queueMicrotask(refresh);
  const selectPane = (event) => {
    const element = event.target.closest('.layerGroup');
    const pane = getPanes().find((item) =>
      item.group.getDivId() === element?.id);
    if (pane) {
      stage.setActiveLayerGroup(pane.index);
    }
    scheduleRefresh();
  };
  workspace.addEventListener('pointerdown', selectPane);
  workspace.addEventListener('focusin', selectPane);
  rootDocument.getElementById('changelayout')
    .addEventListener('change', scheduleRefresh);
  new MutationObserver(scheduleRefresh).observe(workspace, {childList: true});
  refresh();
}
