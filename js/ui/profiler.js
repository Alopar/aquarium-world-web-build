import { MetricBuffer } from './metric-buffer.js';
import { drawSparkline } from './sparkline.js';

const BUFFER_CAPACITY = 300;
const FPS_SMOOTH_WINDOW = 0.5;
const TOGGLE_KEY = 'KeyP';

const SPARKLINE_COLORS = {
  fps: 'rgba(100, 220, 160, 0.9)',
  frameMs: 'rgba(255, 180, 100, 0.9)',
  drawCalls: 'rgba(120, 200, 255, 0.9)',
  triangles: 'rgba(160, 140, 255, 0.9)',
  solids: 'rgba(180, 220, 140, 0.9)',
  dirtyChunks: 'rgba(255, 120, 120, 0.9)',
  chunksRebuilt: 'rgba(255, 200, 80, 0.9)',
  blockChanges: 'rgba(200, 160, 255, 0.9)',
  heapMb: 'rgba(140, 200, 220, 0.9)',
};

function formatNum(n, decimals = 0) {
  if (!Number.isFinite(n)) return '—';
  if (decimals === 0) return String(Math.round(n));
  return n.toFixed(decimals);
}

function formatMb(bytes) {
  if (!Number.isFinite(bytes)) return 'н/д';
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatCompact(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatNum(n);
}

function createMetricRow(label, valueId) {
  const row = document.createElement('div');
  row.className = 'profiler-metric';
  const lbl = document.createElement('span');
  lbl.className = 'profiler-metric__label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'profiler-metric__value';
  val.id = valueId;
  val.textContent = '—';
  row.append(lbl, val);
  return row;
}

function createGraphBlock(label, canvasId) {
  const block = document.createElement('div');
  block.className = 'profiler-graph';
  const lbl = document.createElement('span');
  lbl.className = 'profiler-graph__label';
  lbl.textContent = label;
  const canvas = document.createElement('canvas');
  canvas.className = 'profiler-graph__canvas';
  canvas.id = canvasId;
  canvas.width = 280;
  canvas.height = 36;
  block.append(lbl, canvas);
  return { block, canvas };
}

export class Profiler {
  /**
   * @param {HTMLElement} rootEl
   * @param {{ hidden?: boolean }} [options]
   */
  constructor(rootEl, options = {}) {
    this.root = rootEl;
    this.mode = 'mini';
    this.hidden = !!options.hidden;
    this.fpsAccum = 0;
    this.fpsFrameCount = 0;
    this.blockChangeAccum = 0;
    this.blockChangeTimer = 0;
    this.blockChangesPerSec = 0;
    this.smoothedFps = 0;

    this.buffers = {
      fps: new MetricBuffer(BUFFER_CAPACITY),
      frameMs: new MetricBuffer(BUFFER_CAPACITY),
      drawCalls: new MetricBuffer(BUFFER_CAPACITY),
      triangles: new MetricBuffer(BUFFER_CAPACITY),
      solids: new MetricBuffer(BUFFER_CAPACITY),
      dirtyChunks: new MetricBuffer(BUFFER_CAPACITY),
      chunksRebuilt: new MetricBuffer(BUFFER_CAPACITY),
      blockChanges: new MetricBuffer(BUFFER_CAPACITY),
      heapMb: new MetricBuffer(BUFFER_CAPACITY),
    };

    this.canvases = {};
    this.valueEls = {};

    this.buildDom();
    this.bindKeys();
    this.applyVisibility();
  }

  applyVisibility() {
    this.root.classList.toggle('hidden', this.hidden);
  }

  buildDom() {
    this.root.innerHTML = '';
    this.root.classList.add('profiler', 'profiler--mini');

    const hint = document.createElement('span');
    hint.className = 'profiler-hint';
    this.hintEl = hint;

    const mini = document.createElement('div');
    mini.className = 'profiler-mini';
    this.miniWrapEl = mini;

    const miniGrid = document.createElement('div');
    miniGrid.className = 'profiler-mini__metrics';
    this.miniValueEls = {};
    for (const [label, id] of [
      ['FPS', 'prof-mini-fps'],
      ['Blocks', 'prof-mini-blocks'],
      ['Draw', 'prof-mini-draw'],
      ['Tris', 'prof-mini-tris'],
    ]) {
      const row = createMetricRow(label, id);
      this.miniValueEls[id] = row.querySelector(`#${id}`);
      miniGrid.appendChild(row);
    }
    mini.appendChild(miniGrid);

    const max = document.createElement('div');
    max.className = 'profiler-max hidden';

    const sections = [
      {
        title: 'Кадр',
        metrics: [
          ['FPS', 'prof-fps'],
          ['Кадр, мс', 'prof-frame-ms'],
          ['Update, мс', 'prof-update-ms'],
        ],
        graphs: [
          ['FPS', 'prof-graph-fps', 'fps'],
          ['Кадр, мс', 'prof-graph-frame', 'frameMs'],
        ],
      },
      {
        title: 'Рендер',
        metrics: [
          ['Draw calls', 'prof-draw-calls'],
          ['Triangles', 'prof-triangles'],
          ['Geometries', 'prof-geometries'],
          ['Textures', 'prof-textures'],
          ['Разрешение', 'prof-resolution'],
        ],
        graphs: [
          ['Draw calls', 'prof-graph-draws', 'drawCalls'],
          ['Triangles', 'prof-graph-tris', 'triangles'],
        ],
      },
      {
        title: 'Наполнение',
        metrics: [
          ['Всего', 'prof-total'],
          ['Твёрдые', 'prof-solids'],
          ['Жидкости', 'prof-liquids'],
          ['Газы', 'prof-gases'],
          ['Заполнение', 'prof-fill'],
        ],
        graphs: [
          ['Твёрдые', 'prof-graph-solids', 'solids'],
        ],
      },
      {
        title: 'Меши / чанки',
        metrics: [
          ['Чанки', 'prof-chunks'],
          ['Очередь чанков', 'prof-dirty'],
          ['Meshes', 'prof-meshes'],
          ['Vertices', 'prof-vertices'],
          ['Triangles (mesh)', 'prof-mesh-tris'],
          ['Пересобрано/кадр', 'prof-rebuilt'],
        ],
        graphs: [
          ['Очередь чанков', 'prof-graph-dirty', 'dirtyChunks'],
          ['Пересобрано', 'prof-graph-rebuilt', 'chunksRebuilt'],
        ],
      },
      {
        title: 'Динамика',
        metrics: [
          ['Изменений/с', 'prof-block-rate'],
          ['Скорость', 'prof-speed'],
          ['Режим', 'prof-mode'],
          ['На земле', 'prof-ground'],
          ['Мышь', 'prof-mouse'],
        ],
        graphs: [
          ['Изменений/с', 'prof-graph-blocks', 'blockChanges'],
        ],
      },
      {
        title: 'Память',
        metrics: [
          ['Heap used', 'prof-heap-used'],
          ['Heap total', 'prof-heap-total'],
        ],
        graphs: [
          ['Heap, МБ', 'prof-graph-heap', 'heapMb'],
        ],
      },
    ];

    for (const sec of sections) {
      const section = document.createElement('div');
      section.className = 'profiler-section';

      const title = document.createElement('div');
      title.className = 'profiler-section__title';
      title.textContent = sec.title;
      section.appendChild(title);

      const metricsGrid = document.createElement('div');
      metricsGrid.className = 'profiler-metrics';
      for (const [label, id] of sec.metrics) {
        const row = createMetricRow(label, id);
        this.valueEls[id] = row.querySelector(`#${id}`);
        metricsGrid.appendChild(row);
      }
      section.appendChild(metricsGrid);

      if (sec.graphs?.length) {
        const graphsWrap = document.createElement('div');
        graphsWrap.className = 'profiler-graphs';
        for (const [label, canvasId, bufferKey] of sec.graphs) {
          const { block, canvas } = createGraphBlock(label, canvasId);
          this.canvases[bufferKey] = canvas;
          graphsWrap.appendChild(block);
        }
        section.appendChild(graphsWrap);
      }

      max.appendChild(section);
    }

    this.maxEl = max;
    this.root.append(hint, mini, max);
    this.updateHint();
  }

  bindKeys() {
    this._onKeyDown = (e) => {
      if (e.code !== TOGGLE_KEY || e.repeat) return;
      e.preventDefault();
      this.toggle();
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  toggle() {
    this.setMode(this.mode === 'mini' ? 'max' : 'mini');
  }

  updateHint() {
    this.hintEl.textContent = this.mode === 'mini' ? 'P — развернуть' : 'P — свернуть';
  }

  setMode(mode) {
    this.mode = mode;
    this.root.classList.toggle('profiler--mini', mode === 'mini');
    this.root.classList.toggle('profiler--max', mode === 'max');
    this.maxEl.classList.toggle('hidden', mode === 'mini');
    this.miniWrapEl.classList.toggle('hidden', mode === 'max');
    this.updateHint();
  }

  setText(id, text) {
    const el = this.valueEls[id];
    if (el) el.textContent = text;
  }

  frame({ dt, updateMs, world, renderer, playerController }) {
    if (this.hidden) return;

    const frameMs = dt * 1000;

    this.fpsAccum += dt;
    this.fpsFrameCount++;
    if (this.fpsAccum >= FPS_SMOOTH_WINDOW) {
      this.smoothedFps = this.fpsFrameCount / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrameCount = 0;
    }

    const instantFps = dt > 0 ? 1 / dt : 0;
    const displayFps = this.smoothedFps > 0 ? this.smoothedFps : instantFps;

    const worldStats = world?.getStats() ?? {};
    const meshStats = world?.meshBuilder?.getStats() ?? {};
    const grid = world?.grid;
    const gridCapacity = grid ? grid.size.x * grid.size.y * grid.size.z : 0;

    if (grid) {
      this.blockChangeAccum += grid.consumeBlockChanges();
    }
    this.blockChangeTimer += dt;
    if (this.blockChangeTimer >= 1) {
      this.blockChangesPerSec = this.blockChangeAccum / this.blockChangeTimer;
      this.blockChangeAccum = 0;
      this.blockChangeTimer = 0;
    }

    const renderInfo = renderer?.info;
    const drawCalls = renderInfo?.render?.calls ?? 0;
    const triangles = renderInfo?.render?.triangles ?? 0;
    const geometries = renderInfo?.memory?.geometries ?? 0;
    const textures = renderInfo?.memory?.textures ?? 0;

    const canvas = renderer?.domElement;
    const pixelRatio = renderer?.getPixelRatio?.() ?? 1;
    const resolution = canvas
      ? `${canvas.width}×${canvas.height} @${formatNum(pixelRatio, 1)}x`
      : '—';

    const mem = performance.memory;
    const heapUsed = mem?.usedJSHeapSize ?? NaN;
    const heapTotal = mem?.totalJSHeapSize ?? NaN;
    const heapMb = Number.isFinite(heapUsed) ? heapUsed / (1024 * 1024) : NaN;

    const velocity = playerController?.velocity;
    const speed = velocity
      ? Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
      : 0;

    const solids = worldStats.solids ?? 0;
    const fillPct = gridCapacity > 0 ? (grid.count() / gridCapacity) * 100 : 0;

    this.buffers.fps.push(displayFps);
    this.buffers.frameMs.push(frameMs);
    this.buffers.drawCalls.push(drawCalls);
    this.buffers.triangles.push(triangles);
    this.buffers.solids.push(solids);
    this.buffers.dirtyChunks.push(meshStats.dirtyChunks ?? 0);
    this.buffers.chunksRebuilt.push(meshStats.chunksRebuiltLastFrame ?? 0);
    this.buffers.blockChanges.push(this.blockChangesPerSec);
    if (Number.isFinite(heapMb)) this.buffers.heapMb.push(heapMb);

    this.miniValueEls['prof-mini-fps'].textContent = formatNum(displayFps);
    this.miniValueEls['prof-mini-blocks'].textContent = formatCompact(solids);
    this.miniValueEls['prof-mini-draw'].textContent = formatNum(drawCalls);
    this.miniValueEls['prof-mini-tris'].textContent = formatCompact(triangles);

    this.setText('prof-fps', formatNum(displayFps, 1));
    this.setText('prof-frame-ms', formatNum(frameMs, 1));
    this.setText('prof-update-ms', formatNum(updateMs, 2));
    this.setText('prof-draw-calls', formatNum(drawCalls));
    this.setText('prof-triangles', formatNum(triangles));
    this.setText('prof-geometries', formatNum(geometries));
    this.setText('prof-textures', formatNum(textures));
    this.setText('prof-resolution', resolution);
    this.setText('prof-total', formatCompact(worldStats.total ?? 0));
    this.setText('prof-solids', formatCompact(solids));
    this.setText('prof-liquids', formatCompact(worldStats.liquids ?? 0));
    this.setText('prof-gases', formatCompact(worldStats.gases ?? 0));
    this.setText('prof-fill', `${formatNum(fillPct, 1)}%`);
    this.setText('prof-chunks', formatNum(meshStats.chunkCount ?? 0));
    this.setText('prof-dirty', formatNum(meshStats.dirtyChunks ?? 0));
    this.setText('prof-meshes', formatNum(meshStats.meshCount ?? 0));
    this.setText('prof-vertices', formatNum(meshStats.vertices ?? 0));
    this.setText('prof-mesh-tris', formatNum(meshStats.triangles ?? 0));
    this.setText('prof-rebuilt', formatNum(meshStats.chunksRebuiltLastFrame ?? 0));
    this.setText('prof-block-rate', formatNum(this.blockChangesPerSec, 1));
    this.setText('prof-speed', `${formatNum(speed, 1)} м/с`);
    this.setText('prof-mode', playerController?.modeLabel ?? '—');
    this.setText('prof-ground', playerController?.onGround ? 'да' : 'нет');
    this.setText(
      'prof-mouse',
      playerController?.isLocked ? 'захвачена' : 'свободна',
    );
    this.setText('prof-heap-used', formatMb(heapUsed));
    this.setText('prof-heap-total', formatMb(heapTotal));

    if (this.mode === 'max') {
      this.drawGraphs();
    }
  }

  drawGraphs() {
    for (const [key, canvas] of Object.entries(this.canvases)) {
      const buffer = this.buffers[key];
      if (!buffer) continue;
      const values = buffer.getValues();
      const color = SPARKLINE_COLORS[key] ?? 'rgba(120, 200, 255, 0.9)';

      let min = null;
      let max = null;
      if (key === 'fps') {
        min = 0;
        max = Math.max(60, ...values, 1);
      } else if (key === 'frameMs') {
        min = 0;
        max = Math.max(16.7, ...values, 1);
      }

      drawSparkline(canvas, values, { color, min, max });
    }
  }

  dispose() {
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
    }
  }
}
