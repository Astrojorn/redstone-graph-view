var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value,
      })
    : (obj[key] = value);
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) =>
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src.ts
var src_exports = {};
__export(src_exports, {
  default: () => RedStoneGraphPlugin,
});
module.exports = __toCommonJS(src_exports);
var import_siyuan = require("siyuan");
var COLORS = [
  "#7c6aff",
  "#ff6b6b",
  "#43d9ad",
  "#f7c948",
  "#4ea8de",
  "#ff9a3c",
  "#c084fc",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#a3e635",
  "#f472b6",
];
var DB_COLOR = "#14b8a6";
function detectCommunities(nodes, edges) {
  const community = {};
  nodes.forEach((n) => (community[n.id] = n.id));
  const adj = {};
  nodes.forEach((n) => (adj[n.id] = []));
  edges.forEach(({ source: s, target: t }) => {
    const si = typeof s === "object" ? s.id : s,
      ti = typeof t === "object" ? t.id : t;
    if (adj[si]) adj[si].push(ti);
    if (adj[ti]) adj[ti].push(si);
  });
  let changed = true,
    iter = 0;
  while (changed && iter++ < 80) {
    changed = false;
    const ids = nodes.map((n) => n.id).sort(() => Math.random() - 0.5);
    for (const id of ids) {
      const freq = {};
      for (const nb of adj[id])
        freq[community[nb]] = (freq[community[nb]] || 0) + 1;
      let best = community[id],
        bestN = 0;
      for (const [c, n] of Object.entries(freq))
        if (n > bestN) {
          bestN = n;
          best = c;
        }
      if (best !== community[id]) {
        community[id] = best;
        changed = true;
      }
    }
  }
  const unique = [...new Set(Object.values(community))];
  const idx = {};
  unique.forEach((c, i) => (idx[c] = i));
  const result = {};
  for (const [id, c] of Object.entries(community)) result[id] = idx[c];
  return result;
}
async function sql(stmt) {
  const r = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stmt }),
  });
  return (await r.json()).data || [];
}
async function fetchGraphData() {
  const docs = await sql(
    "SELECT id, content, hpath FROM blocks WHERE type='d' LIMIT 2000",
  );
  const docIds = new Set(docs.map((d) => d.id));
  const customAvs = await sql(
    "SELECT block_id, value FROM attributes WHERE name='custom-avs' LIMIT 3000",
  );
  const avToPages = {};
  customAvs.forEach(({ block_id, value }) => {
    if (!value || !docIds.has(block_id)) return;
    const avId = value.trim();
    if (!avToPages[avId]) avToPages[avId] = [];
    avToPages[avId].push(block_id);
  });
  const avIds = Object.keys(avToPages);
  const avNameMap = {};
  await Promise.all(
    avIds.map(async (avId) => {
      try {
        const r = await fetch("/api/av/renderAttributeView", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: avId, viewID: "", pageSize: 1 }),
        });
        const j = await r.json();
        if (j.code === 0 && j.data?.name) {
          avNameMap[avId] = j.data.name;
        }
      } catch (_) {}
    }),
  );
  const dbNodes = avIds.map((avId) => ({
    id: avId,
    label: avNameMap[avId] || "Database",
    nodeType: "db",
  }));
  // Use higher limits and join to get root_id directly — avoids missed connections
  const refs = await sql(
    "SELECT r.block_id, r.def_block_root_id, b.root_id as src_root FROM refs r LEFT JOIN blocks b ON b.id=r.block_id LIMIT 10000",
  );
  const edgeSet = /* @__PURE__ */ new Set(),
    edges = [];
  refs.forEach(({ block_id, def_block_root_id, src_root }) => {
    // src_root is the doc that CONTAINS the block making the ref
    // If src_root is null (block IS a doc), fall back to block_id itself
    const src = src_root || block_id;
    const tgt = def_block_root_id;
    if (src && tgt && src !== tgt && docIds.has(src) && docIds.has(tgt)) {
      const key = src < tgt ? `${src}|${tgt}` : `${tgt}|${src}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: src, target: tgt, kind: "ref" });
      }
    }
  });
  Object.entries(avToPages).forEach(([avId, pageIds]) => {
    pageIds.forEach((pageId) => {
      const key = pageId < avId ? `${pageId}|${avId}` : `${avId}|${pageId}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: pageId, target: avId, kind: "db" });
      }
    });
  });
  const nodes = [
    ...docs.map((d) => ({
      id: d.id,
      label: d.content || d.hpath || d.id,
      nodeType: "doc",
      // SiYuan block IDs encode creation time: first 14 chars = YYYYMMDDHHmmss
      created: d.id ? parseInt(d.id.slice(0,14), 10) || 0 : 0,
    })),
    ...dbNodes.map((d) => ({ ...d, created: d.id ? parseInt(d.id.slice(0,14), 10) || 0 : 0 })),
  ];
  return { nodes, edges };
}
function loadD3() {
  return new Promise((resolve, reject) => {
    if (window.d3) {
      resolve(window.d3);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
    s.onload = () => resolve(window.d3);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function renderGraph(container, lang = "pt", initShowTitles = true, initShowArrows = true, plugin = null, initParams = null) {
  const tr = (k) => I18N[lang]?.[k] || I18N["en"][k] || k;
  container.innerHTML = `
  <style>
    .og-root{display:flex;flex-direction:column;height:100%;background:var(--b3-theme-background);font-family:var(--b3-font-family);}
    .og-toolbar{display:flex;align-items:center;gap:5px;padding:5px 8px;border-bottom:1px solid var(--b3-border-color);flex-shrink:0;flex-wrap:wrap;}
    .og-search{flex:1;min-width:70px;padding:3px 7px;border-radius:5px;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);font-size:12px;outline:none;}
    .og-btn{padding:3px 8px;border-radius:5px;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;font-size:12px;white-space:nowrap;user-select:none;}
    .og-btn:hover{opacity:.8;}
    .og-btn.on{background:var(--b3-theme-primary);color:#fff;border-color:transparent;}
    .og-ctrl{display:flex;align-items:center;gap:3px;font-size:11px;color:var(--b3-theme-on-surface);}
    .og-ctrl input[type=range]{width:60px;accent-color:var(--b3-theme-primary);cursor:pointer;}
    .og-ctrl-val{min-width:22px;font-size:10px;opacity:.6;}
    .og-wrap{flex:1;position:relative;overflow:hidden;min-height:0;}
    .og-svg{width:100%;height:100%;display:block;}
    .og-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;opacity:.6;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);}
    .og-legend{display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px;border-top:1px solid var(--b3-border-color);flex-shrink:0;min-height:20px;align-items:center;}
  </style>
  <div class="og-root">
    <div class="og-toolbar">
      <input class="og-search" type="text" placeholder="${tr("search")}"/>
      <button class="og-btn" id="og-refresh" title="${tr("reload")}">\u21BA</button>
      <button class="og-btn on" id="og-titles-btn">${tr("titles")}</button>
      <button class="og-btn on" id="og-arrows-btn">${tr("arrows")}</button>
      <button class="og-btn" id="og-local-btn" title="${tr("localGraphTip")}">\u2299 ${tr("localGraph")}</button>
        <button class="og-btn" id="og-timeline-btn" title="${tr('timelineTip')}">&#9654; ${tr('timeline')}</button>
      <div class="og-ctrl">
        <span>${tr("dist")}</span>
        <input type="range" id="og-dist" min="20" max="600" value="140"/>
        <span class="og-ctrl-val" id="og-dist-v">140</span>
      </div>
      <div class="og-ctrl">
        <span>${tr("cluster")}</span>
        <input type="range" id="og-cluster" min="0" max="100" value="30"/>
        <span class="og-ctrl-val" id="og-cluster-v">30</span>
      </div>
      <div class="og-ctrl">
        <span>${tr("repulsion")}</span>
        <input type="range" id="og-charge" min="30" max="800" value="200"/>
        <span class="og-ctrl-val" id="og-charge-v">200</span>
      </div>
    </div>
    <div class="og-wrap">
      <svg class="og-svg" id="og-svg"></svg>
      <div class="og-loading" id="og-loading">${tr("loading")}</div>
    </div>
    <div class="og-legend" id="og-legend"></div>
  </div>`;
  let sim = null;
  const params = initParams
    ? { dist: initParams.dist ?? 140, cluster: initParams.cluster ?? 30, charge: initParams.charge ?? 200 }
    : { dist: 140, cluster: 30, charge: 200 };
  let showTitles = initShowTitles;
  let showArrows = initShowArrows;
  const titlesBtn = container.querySelector("#og-titles-btn");
  titlesBtn.classList.toggle("on", showTitles);
  titlesBtn.addEventListener("click", () => {
    showTitles = !showTitles;
    titlesBtn.classList.toggle("on", showTitles);
    container.querySelectorAll(".og-label").forEach((el) => {
      el.style.display = showTitles ? "" : "none";
    });
    if (sim) {
      sim.force("collide").radius((d) => nodeR(d) + (showTitles ? 28 : 8));
      if (sim.alpha() < 0.05) sim.alpha(0.08).restart();
    }
    if (plugin) { plugin._showTitles = showTitles; plugin._savePrefs(); }
  });
  const arrowsBtn = container.querySelector("#og-arrows-btn");
  arrowsBtn.classList.toggle("on", showArrows);
  arrowsBtn.addEventListener("click", () => {
    showArrows = !showArrows;
    arrowsBtn.classList.toggle("on", showArrows);
    container.querySelectorAll("#og-svg line").forEach((el) => {
      if (showArrows) {
        const kind = el.getAttribute("data-kind");
        el.setAttribute(
          "marker-end",
          kind === "db" ? "url(#og-arr-db)" : "url(#og-arr)",
        );
      } else {
        el.removeAttribute("marker-end");
      }
    });
    if (plugin) { plugin._showArrows = showArrows; plugin._savePrefs(); }
  });
  let localMode = false;
  let currentPageId = null;
  // Fast, synchronous-first doc detection using multiple strategies
  function getActiveDocIdSync() {
    // Strategy 1: SiYuan stores the active editor's root ID on the protyle element
    const focusedProtyle = document.querySelector(
      ".layout__wnd--active .protyle:not(.fn__none), .protyle--focus"
    );
    if (focusedProtyle) {
      // The protyle title block data-node-id IS the root doc id in SiYuan
      const titleBlock = focusedProtyle.querySelector(".protyle-title[data-node-id]");
      if (titleBlock) return titleBlock.getAttribute("data-node-id");
      // Or from the breadcrumb first item (root doc)
      const breadFirst = focusedProtyle.querySelector(
        ".protyle-breadcrumb [data-node-id]:first-child, .protyle-breadcrumb__item[data-node-id]"
      );
      if (breadFirst) return breadFirst.getAttribute("data-node-id");
    }
    // Strategy 2: active tab's data-id
    const activeTab = document.querySelector(
      ".layout__wnd--active .item--focus[data-id], .item--focus[data-id]"
    );
    if (activeTab) return activeTab.getAttribute("data-id");
    // Strategy 3: any visible protyle title
    const anyTitle = document.querySelector(".protyle-title[data-node-id]");
    if (anyTitle) return anyTitle.getAttribute("data-node-id");
    return null;
  }

  async function getCurrentDocId() {
    try {
      // Try sync first — fast and works most of the time
      const syncId = getActiveDocIdSync();
      if (syncId) {
        // Validate it's actually a doc (root_id == id means it IS a doc)
        const r = await fetch("/api/block/getBlockInfo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: syncId }),
        });
        const j = await r.json();
        if (j.code === 0) return j.data?.rootID || j.data?.id || syncId;
      }
      return null;
    } catch (_) { return null; }
  }

  // Set slider values from saved params
  const distSlider = container.querySelector("#og-dist");
  const clusterSlider = container.querySelector("#og-cluster");
  const chargeSlider = container.querySelector("#og-charge");
  if (distSlider) { distSlider.value = String(params.dist); container.querySelector("#og-dist-v").textContent = String(params.dist); }
  if (clusterSlider) { clusterSlider.value = String(params.cluster); container.querySelector("#og-cluster-v").textContent = String(params.cluster); }
  if (chargeSlider) { chargeSlider.value = String(params.charge); container.querySelector("#og-charge-v").textContent = String(params.charge); }

  const localBtn = container.querySelector("#og-local-btn");
  localBtn.addEventListener("click", async () => {
    localMode = !localMode;
    localBtn.classList.toggle("on", localMode);
    if (localMode) {
      currentPageId = await getCurrentDocId();
      applyLocalFilter();
    } else {
      clearLocalFilter();
    }
  });

  // ── Auto-detect tab changes when local graph is active ─────────────────────
  // Watch for focus changes on tabs and protyles
  let _tabWatchObs = null;
  let _tabWatchDebounce = null;

  function startTabWatch() {
    if (_tabWatchObs) return; // already watching
    const onTabChange = () => {
      if (!localMode) return;
      clearTimeout(_tabWatchDebounce);
      _tabWatchDebounce = setTimeout(async () => {
        const newId = await getCurrentDocId();
        if (newId && newId !== currentPageId) {
          currentPageId = newId;
          applyLocalFilter();
          // Flash the local button to signal page changed
          localBtn.style.outline = "2px solid var(--b3-theme-primary)";
          setTimeout(() => { localBtn.style.outline = ""; }, 600);
        }
      }, 200); // 200ms debounce — fast enough for tab clicks
    };

    // Watch for class changes on items (item--focus appears on active tab)
    _tabWatchObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          m.attributeName === "class" &&
          (m.target.classList.contains("item--focus") ||
           m.target.classList.contains("protyle--focus") ||
           m.target.classList.contains("layout__wnd--active"))
        ) {
          onTabChange();
          break;
        }
      }
    });
    _tabWatchObs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
  }

  function stopTabWatch() {
    if (_tabWatchObs) { _tabWatchObs.disconnect(); _tabWatchObs = null; }
    clearTimeout(_tabWatchDebounce);
  }

  // Update localBtn click to start/stop tab watch
  localBtn.addEventListener("click", () => {
    if (localMode) startTabWatch();
    else stopTabWatch();
  });

  // Clean up tab watch when graph is re-drawn
  if (container._tabWatchCleanup) container._tabWatchCleanup();
  container._tabWatchCleanup = stopTabWatch;
  function applyLocalFilter() {
    if (!currentPageId || !sim) return;
    const svgEl = container.querySelector("#og-svg");
    if (!svgEl) return;
    const neighborIds = /* @__PURE__ */ new Set([currentPageId]);
    svgEl.querySelectorAll("line").forEach((line) => {
      const d = line.__data__;
      if (!d) return;
      const si = typeof d.source === "object" ? d.source.id : d.source;
      const ti = typeof d.target === "object" ? d.target.id : d.target;
      if (si === currentPageId) neighborIds.add(ti);
      if (ti === currentPageId) neighborIds.add(si);
    });

    const gNodes = svgEl.querySelectorAll("#og-svg > g > g:last-child > g");
    gNodes.forEach((g) => {
      const titleEl = g.querySelector("title");
      const d3node = g.__data__;
      if (d3node) {
        const inScope = neighborIds.has(d3node.id);
        g.style.opacity = inScope ? "1" : "0.05";
      }
    });
    svgEl.querySelectorAll("line").forEach((line) => {
      const d = line.__data__;
      if (!d) return;
      const si = typeof d.source === "object" ? d.source.id : d.source;
      const ti = typeof d.target === "object" ? d.target.id : d.target;
      const visible = neighborIds.has(si) && neighborIds.has(ti);
      line.style.opacity = visible ? "1" : "0.03";
    });
  }
  function clearLocalFilter() {
    const svgEl = container.querySelector("#og-svg");
    if (!svgEl) return;
    svgEl.querySelectorAll("g, line").forEach((el) => {
      el.style.opacity = "";
    });
  }
  async function draw() {
    // Always reset local graph mode on redraw
    if (localMode) {
      localMode = false;
      const lb = container.querySelector("#og-local-btn");
      if (lb) lb.classList.remove("on");
      currentPageId = null;
    }
    const loading = container.querySelector("#og-loading");
    loading.style.display = "flex";
    if (sim) {
      sim.stop();
      sim = null;
    }
    const [d3, { nodes, edges }] = await Promise.all([
      loadD3(),
      fetchGraphData(),
    ]);
    const d3_ = d3;
    const connectedIds = /* @__PURE__ */ new Set();
    edges.forEach(({ source: s, target: t }) => {
      connectedIds.add(typeof s === "object" ? s.id : s);
      connectedIds.add(typeof t === "object" ? t.id : t);
    });
    const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));
    const isolatedNodes = nodes.filter((n) => !connectedIds.has(n.id));
    const communities = detectCommunities(connectedNodes, edges);
    nodes.forEach((n) => {
      n.community = communities[n.id] ?? -1;
      n.isIsolated = !connectedIds.has(n.id);
      n.color =
        n.nodeType === "db"
          ? DB_COLOR
          : n.isIsolated
            ? "#666"
            : COLORS[n.community % COLORS.length];
    });
    const uniqC = [...new Set(connectedNodes.map((n) => n.community))];
    const svgEl = container.querySelector("#og-svg");
    svgEl.innerHTML = "";
    const wrap = container.querySelector(".og-wrap");
    const W = wrap.clientWidth || 500,
      H = wrap.clientHeight || 500;
    const svg = d3_.select(svgEl).attr("width", W).attr("height", H);
    const gRoot = svg.append("g");
    svg.call(
      d3_
        .zoom()
        .scaleExtent([0.02, 20])
        .on("zoom", (ev) => gRoot.attr("transform", ev.transform)),
    );
    const ogCtx = { d3: d3_, svg, gRoot, W, H, nodes, edges };
    container.__ogCtx = ogCtx;
    wrap.__ogCtx = ogCtx;
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "og-arr")
      .attr("viewBox", "0 -3 6 6")
      .attr("refX", 13)
      .attr("refY", 0)
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-3L6,0L0,3")
      .attr("fill", "#888");
    defs
      .append("marker")
      .attr("id", "og-arr-db")
      .attr("viewBox", "0 -3 6 6")
      .attr("refX", 13)
      .attr("refY", 0)
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-3L6,0L0,3")
      .attr("fill", DB_COLOR);
    const outerR = Math.min(W, H) * 0.48;
    // degree calculated below — we pre-position after degree is known
    const degree = {};
    nodes.forEach((n) => (degree[n.id] = 0));
    edges.forEach(({ source: s, target: t }) => {
      const si = typeof s === "object" ? s.id : s,
        ti = typeof t === "object" ? t.id : t;
      degree[si] = (degree[si] || 0) + 1;
      degree[ti] = (degree[ti] || 0) + 1;
    });
    // ── Constellation layout: hub (most connected) at center, satellites orbit ──
    uniqC.forEach((c, ci) => {
      const grp = connectedNodes.filter((n) => n.community === c);
      if (grp.length === 0) return;
      // Sort by degree desc — hub is most connected node
      grp.sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
      const clusterAngle = (ci / Math.max(uniqC.length, 1)) * 2 * Math.PI;
      const clusterR = Math.min(W, H) * 0.30;
      const gcx = W / 2 + clusterR * Math.cos(clusterAngle);
      const gcy = H / 2 + clusterR * Math.sin(clusterAngle);
      // Hub at cluster center
      grp[0].x = gcx; grp[0].y = gcy;
      // Satellites orbit at increasing radii
      grp.slice(1).forEach((n, si) => {
        const orbitR = 30 + si * 10;
        const angle = (si / Math.max(grp.length - 1, 1)) * 2 * Math.PI;
        n.x = gcx + orbitR * Math.cos(angle);
        n.y = gcy + orbitR * Math.sin(angle);
      });
    });
    // Isolated nodes: outer ring
    isolatedNodes.forEach((n, i) => {
      const a = (i / Math.max(isolatedNodes.length, 1)) * 2 * Math.PI;
      n.x = W / 2 + outerR * Math.cos(a);
      n.y = H / 2 + outerR * Math.sin(a);
    });
    // Hub map for radial orbit force
    const hubMap = {};
    uniqC.forEach(c => {
      const grp = connectedNodes.filter(n => n.community === c);
      if (grp.length > 0) {
        hubMap[c] = grp.reduce((best, n) => (degree[n.id]||0) > (degree[best.id]||0) ? n : best, grp[0]);
      }
    });
    const nodeR2 = (d) =>
      d.nodeType === "db"
        ? Math.max(7, Math.min(16, 7 + (degree[d.id] || 0) * 1.2))
        : d.isIsolated
          ? 4
          : Math.max(4, Math.min(12, 4 + (degree[d.id] || 0) * 1.2));
    const pairCount = {},
      pairIdx = {};
    edges.forEach((e) => {
      const si = typeof e.source === "object" ? e.source.id : e.source;
      const ti = typeof e.target === "object" ? e.target.id : e.target;
      const k = si < ti ? `${si}|${ti}` : `${ti}|${si}`;
      pairCount[k] = (pairCount[k] || 0) + 1;
    });
    edges.forEach((e) => {
      const si = typeof e.source === "object" ? e.source.id : e.source;
      const ti = typeof e.target === "object" ? e.target.id : e.target;
      const k = si < ti ? `${si}|${ti}` : `${ti}|${si}`;
      if (pairIdx[k] === void 0) pairIdx[k] = 0;
      e._pk = k;
      e._pi = pairIdx[k];
      e._pt = pairCount[k];
      pairIdx[k]++;
    });
    function offsetLine(e) {
      const sx = e.source.x,
        sy = e.source.y,
        tx = e.target.x,
        ty = e.target.y;
      if (e._pt === 1) return { x1: sx, y1: sy, x2: tx, y2: ty };
      const dx = tx - sx,
        dy = ty - sy,
        len = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = (e._pi - (e._pt - 1) / 2) * 4;
      const ox = (-dy / len) * off,
        oy = (dx / len) * off;
      return { x1: sx + ox, y1: sy + oy, x2: tx + ox, y2: ty + oy };
    }
    const gLinks = gRoot.append("g");
    const link = gLinks
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", (e) => (e.kind === "db" ? DB_COLOR : "#999"))
      .attr("stroke-opacity", (e) => (e.kind === "db" ? 0.6 : 0.35))
      .attr("stroke-width", (e) => (e.kind === "db" ? 1.5 : 1))
      .attr("stroke-dasharray", (e) => (e.kind === "db" ? "5,3" : null))
      .attr("data-kind", (e) => e.kind)
      .attr("marker-end", (e) =>
        e.kind === "db" ? "url(#og-arr-db)" : "url(#og-arr)",
      );
    const gNodes = gRoot.append("g");
    const nodeG = gNodes
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3_
          .drag()
          .on("start", (ev, d) => {
            if (!ev.active) sim.alphaTarget(0.15).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (ev, d) => {
            d.fx = ev.x;
            d.fy = ev.y;
          })
          .on("end", (ev, d) => {
            if (!ev.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      )
      .on("click", (ev, d) => {
        ev.stopPropagation();
        fetch("/api/filetree/openDoc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: d.id }),
        });
      });
    nodeG.each(function (d) {
      const sel = d3_.select(this);
      const r = nodeR2(d);
      if (d.nodeType === "db") {
        sel
          .append("path")
          .attr("d", `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`)
          .attr("fill", d.color)
          .attr("stroke", "var(--b3-theme-background)")
          .attr("stroke-width", 2);
      } else {
        sel
          .append("circle")
          .attr("r", r)
          .attr("fill", d.color)
          .attr("stroke", "var(--b3-theme-background)")
          .attr("stroke-width", d.isIsolated ? 1 : 1.5);
      }
    });
    nodeG
      .append("text")
      .attr("class", "og-label")
      .text((d) =>
        d.label.length > 26 ? d.label.slice(0, 24) + "\u2026" : d.label,
      )
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(nodeR2(d) + (d.nodeType === "db" ? 6 : 4)))
      .attr("font-size", (d) =>
        d.nodeType === "db" ? "11px" : d.isIsolated ? "9px" : "10px",
      )
      .attr("font-weight", (d) => (d.nodeType === "db" ? "600" : "400"))
      .attr("fill", "var(--b3-theme-on-background)")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--b3-theme-background)")
      .attr("stroke-width", 3)
      .attr("pointer-events", "none")
      .style("display", showTitles ? "" : "none");
    nodeG
      .append("title")
      .text(
        (d) =>
          d.label +
          (d.nodeType === "db"
            ? " [DB]"
            : d.isIsolated
              ? " [sem conex\xF5es]"
              : ""),
      );
    // Store nodeG in ctx now that it's fully built
    ogCtx.nodeG = nodeG;
    function clusterForce(alpha) {
      if (params.cluster === 0) return;
      const s = (params.cluster / 100) * alpha * 0.8;
      const cx = {},
        cy = {},
        cn = {};
      for (const d of connectedNodes) {
        cx[d.community] = (cx[d.community] || 0) + d.x;
        cy[d.community] = (cy[d.community] || 0) + d.y;
        cn[d.community] = (cn[d.community] || 0) + 1;
      }
      const centX = {},
        centY = {};
      for (const c of uniqC) {
        centX[c] = cx[c] / cn[c];
        centY[c] = cy[c] / cn[c];
      }
      const ir = (params.cluster / 100) * 0.6;
      for (let i = 0; i < uniqC.length; i++) {
        for (let j = i + 1; j < uniqC.length; j++) {
          const ci = uniqC[i],
            cj = uniqC[j];
          const dx = centX[ci] - centX[cj],
            dy = centY[ci] - centY[cj];
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minD = 130 + (cn[ci] || 1) * 2 + (cn[cj] || 1) * 2;
          if (dist < minD) {
            const f = (ir * (minD - dist)) / dist;
            const fx = dx * f,
              fy = dy * f;
            for (const d of connectedNodes) {
              if (d.community === ci) {
                d.vx += fx * 0.4;
                d.vy += fy * 0.4;
              }
              if (d.community === cj) {
                d.vx -= fx * 0.4;
                d.vy -= fy * 0.4;
              }
            }
          }
        }
      }
      for (const d of connectedNodes) {
        const hub = hubMap[d.community];
        const isHub = hub && hub.id === d.id;
        // Hubs pulled stronger — they anchor the cluster center
        const pullS = isHub ? s * 1.6 : s;
        d.vx += (centX[d.community] - d.x) * pullS;
        d.vy += (centY[d.community] - d.y) * pullS;
        // Satellites: soft radial orbit around their hub
        if (!isHub && hub) {
          const dx = d.x - hub.x, dy = d.y - hub.y;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          const targetR = Math.max(25, (degree[d.id]||0) * 6 + 18);
          const radialF = (dist - targetR) / dist * alpha * 0.035;
          d.vx -= dx * radialF;
          d.vy -= dy * radialF;
        }
      }
    }
    function orbitForce(alpha) {
      if (isolatedNodes.length === 0) return;
      let mx = W / 2,
        my = H / 2;
      if (connectedNodes.length > 0) {
        mx =
          connectedNodes.reduce((a, d) => a + d.x, 0) / connectedNodes.length;
        my =
          connectedNodes.reduce((a, d) => a + d.y, 0) / connectedNodes.length;
      }
      const targetR = outerR;
      const strength = alpha * 0.15;
      isolatedNodes.forEach((d) => {
        const dx = d.x - mx,
          dy = d.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = dist - targetR;
        d.vx -= (dx / dist) * diff * strength;
        d.vy -= (dy / dist) * diff * strength;
      });
    }
    function ticked() {
      link.each(function (e) {
        const { x1, y1, x2, y2 } = offsetLine(e);
        d3_
          .select(this)
          .attr("x1", x1)
          .attr("y1", y1)
          .attr("x2", x2)
          .attr("y2", y2);
      });
      nodeG.attr("transform", (d) => `translate(${d.x},${d.y})`);
    }
    sim = d3_
      .forceSimulation(nodes)
      .force(
        "link",
        d3_
          .forceLink(edges)
          .id((d) => d.id)
          .distance(params.dist)
          .strength(0.4),
      )
      .force(
        "charge",
        d3_
          .forceManyBody()
          .strength((d) => (d.isIsolated ? -40 : -params.charge))
          .distanceMax(600)
          .distanceMin(5),
      )
      .force("center", d3_.forceCenter(W / 2, H / 2).strength(0.015))
      .force(
        "collide",
        d3_
          .forceCollide()
          .radius((d) => nodeR2(d) + (showTitles ? 28 : 8))
          .strength(1)
          .iterations(4),
      )
      .force("cluster", clusterForce)
      .force("orbit", orbitForce)
      // separation removed — forceCollide handles overlap
      .alphaDecay(0.01)
      .velocityDecay(0.45)
      .on("tick", ticked);

    // ── ResizeObserver: re-center graph when panel/window resizes ──────────
    if (container._ogResizeObs) { container._ogResizeObs.disconnect(); }

    // Debounce timer — wait for resize to settle before recentering
    let _resizeTimer = null;
    let _prevW = wrap.clientWidth;
    let _prevH = wrap.clientHeight;

    let _recenterRafId = null;

    const recenter = (newW, newH) => {
      const ctx = container.__ogCtx;
      if (!ctx || !sim) return;

      // Update SVG canvas size immediately — no animation here
      d3_.select(svgEl).attr("width", newW).attr("height", newH);

      // Compute bounding box of all nodes in graph space
      const allNodes = sim.nodes();
      if (!allNodes || allNodes.length === 0) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of allNodes) {
        if (isFinite(n.x) && n.x < minX) minX = n.x;
        if (isFinite(n.x) && n.x > maxX) maxX = n.x;
        if (isFinite(n.y) && n.y < minY) minY = n.y;
        if (isFinite(n.y) && n.y > maxY) maxY = n.y;
      }
      if (!isFinite(minX)) return; // no valid node positions yet

      const graphW = maxX - minX || 1;
      const graphH = maxY - minY || 1;
      const graphCX = (minX + maxX) / 2;
      const graphCY = (minY + maxY) / 2;

      // Fit graph in viewport with padding, keep current scale if reasonable
      const padding = 80;
      const currentTf = d3_.zoomTransform(svgEl);
      const currentScale = currentTf.k;
      const scaleX = (newW - padding * 2) / graphW;
      const scaleY = (newH - padding * 2) / graphH;
      // Target scale: fit-to-viewport but stay close to current scale (avoid jarring zoom)
      const fitScale = Math.min(scaleX, scaleY, 1.0);
      const targetScale = currentScale < 0.1 || currentScale > 3
        ? fitScale                                   // very zoomed: reset fully
        : currentScale * 0.5 + fitScale * 0.5;      // blend: smooth nudge toward fit

      // Target translation: graph center → viewport center
      const targetTx = newW / 2 - graphCX * targetScale;
      const targetTy = newH / 2 - graphCY * targetScale;

      // Animate from current transform to target using RAF (no D3 transition conflict)
      if (_recenterRafId) cancelAnimationFrame(_recenterRafId);
      const startTx = currentTf.x;
      const startTy = currentTf.y;
      const startScale = currentTf.k;
      const duration = 400;
      const startTime = performance.now();

      const step = (now) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const e = 1 - Math.pow(1 - t, 3);

        const ix = startTx + (targetTx - startTx) * e;
        const iy = startTy + (targetTy - startTy) * e;
        const ik = startScale + (targetScale - startScale) * e;

        const tf = d3_.zoomIdentity.translate(ix, iy).scale(ik);
        ctx.gRoot.attr("transform", tf.toString());
        ctx.svg.property("__zoom", tf);

        if (t < 1) {
          _recenterRafId = requestAnimationFrame(step);
        } else {
          _recenterRafId = null;
          // Update center force gently to new center
          sim.force("center", d3_.forceCenter(newW / 2, newH / 2).strength(0.015));
          if (sim.alpha() < 0.02) sim.alpha(0.04).restart();
        }
      };
      _recenterRafId = requestAnimationFrame(step);

      // Update stored dimensions right away
      ctx.W = newW;
      ctx.H = newH;
      wrap.__ogCtx = ctx;
      container.__ogCtx = ctx;
    };

    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = entry.contentRect.width;
        const newH = entry.contentRect.height;
        if (newW < 10 || newH < 10) return; // panel is hidden

        // Always update SVG size immediately (no debounce for that)
        d3_.select(svgEl).attr("width", newW).attr("height", newH);

        // Debounce the recentering — wait 120ms after resize settles
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
          const dW = Math.abs(newW - _prevW);
          const dH = Math.abs(newH - _prevH);
          // Only recenter if size changed meaningfully (> 5px)
          if (dW > 5 || dH > 5) {
            recenter(newW, newH);
            _prevW = newW;
            _prevH = newH;
          }
        }, 120);
      }
    });
    resizeObs.observe(wrap);
    container._ogResizeObs = resizeObs;

    // Expose recenter function so _toggleFullscreen can call it too
    container._ogRecenter = recenter;

    // Also store directly on the wrap element
    wrap._ogRecenter = recenter;
    const counts = {};
    connectedNodes.forEach(
      (n) => (counts[n.community] = (counts[n.community] || 0) + 1),
    );
    const dbCount = nodes.filter((n) => n.nodeType === "db").length;
    const legend = container.querySelector("#og-legend");
    const clusterItems = uniqC
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 10)
      .map(
        (
          c,
        ) => `<span style="display:flex;align-items:center;gap:3px;font-size:11px;opacity:.75">
        <span style="width:9px;height:9px;border-radius:50%;background:${COLORS[c % COLORS.length]};flex-shrink:0"></span>
        <span>${counts[c]}</span></span>`,
      )
      .join("");
    const isoItem =
      isolatedNodes.length > 0
        ? `<span style="display:flex;align-items:center;gap:3px;font-size:11px;opacity:.55;margin-left:4px">
      <span style="width:9px;height:9px;border-radius:50%;background:#666;flex-shrink:0"></span>
      <span>${isolatedNodes.length} ${tr("isolated")}</span></span>`
        : "";
    const dbItem =
      dbCount > 0
        ? `<span style="display:flex;align-items:center;gap:3px;font-size:11px;opacity:.75;margin-left:4px;border-left:1px solid var(--b3-border-color);padding-left:6px">
      <svg width="10" height="10" viewBox="-5 -5 10 10"><path d="M0,-5 L5,0 L0,5 L-5,0 Z" fill="${DB_COLOR}"/></svg>
      <span>${dbCount} ${tr("db")}</span></span>`
        : "";
    legend.innerHTML = clusterItems + isoItem + dbItem;
    loading.style.display = "none";
    if (!showTitles) {
      container.querySelectorAll(".og-label").forEach((el) => {
        el.style.display = "none";
      });
    }
    if (!showArrows) {
      container.querySelectorAll("#og-svg line").forEach((el) => {
        el.removeAttribute("marker-end");
      });
    }
  }
  function wireControls() {
    function slider(id, vid, key, onUpdate) {
      const sl = container.querySelector(id);
      const vl = container.querySelector(vid);
      sl.addEventListener("input", () => {
        params[key] = +sl.value;
        vl.textContent = sl.value;
        onUpdate();
        if (plugin) { plugin._params = { ...params }; plugin._savePrefs(); }
      });
    }
    slider("#og-dist", "#og-dist-v", "dist", () => {
      if (!sim) return;
      sim.force("link").distance(params.dist);
      if (sim.alpha() < 0.05) sim.alpha(0.08).restart();
    });
    slider("#og-cluster", "#og-cluster-v", "cluster", () => {
      if (!sim) return;
      if (sim.alpha() < 0.05) sim.alpha(0.08).restart();
    });
    slider("#og-charge", "#og-charge-v", "charge", () => {
      if (!sim) return;
      sim
        .force("charge")
        .strength((d) => (d.isIsolated ? -30 : -params.charge));
      if (sim.alpha() < 0.05) sim.alpha(0.08).restart();
    });
    container.querySelector(".og-search").addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase();
      container
        .querySelectorAll("#og-svg circle, #og-svg path")
        .forEach((el) => {
          const g = el.closest("g");
          const title =
            g?.querySelector("title")?.textContent?.toLowerCase() || "";
          el.style.opacity = !term || title.includes(term) ? "1" : "0.04";
        });
    });
    container.querySelector("#og-refresh").addEventListener("click", () => {
      if (localMode) {
        localMode = false;
        localBtn.classList.remove("on");
        currentPageId = null;
      }
      // Stop timeline if running
      if (_timelineRunning) stopTimeline();
      draw();
    });
  }
  wireControls();
  await draw();

  // ── Timeline animation ────────────────────────────────────────────────────
  let _timelineRunning = false;
  let _timelineRaf = null;
  let _timelineTimer = null;

  function stopTimeline() {
    _timelineRunning = false;
    if (_timelineRaf) { cancelAnimationFrame(_timelineRaf); _timelineRaf = null; }
    clearTimeout(_timelineTimer);
    const btn = container.querySelector("#og-timeline-btn");
    if (btn) {
      btn.classList.remove("on");
      btn.style.backgroundImage = "";
      btn.style.color = "";
    }
    // Restore full visibility on all SVG elements
    const svgEl = container.querySelector("#og-svg");
    if (!svgEl) return;
    svgEl.querySelectorAll("circle, path, line, text").forEach(el => {
      el.style.opacity = "";
      el.style.transition = "";
      el.style.filter = "";
    });
  }

  function startTimeline(allNodes, allEdges) {
    // Toggle: second click stops
    if (_timelineRunning) { stopTimeline(); return; }

    // Sort by creation date oldest → newest
    // SiYuan IDs: first 14 chars = YYYYMMDDHHmmss
    const sorted = [...allNodes]
      .map(n => ({ ...n, created: parseInt((n.id || "").slice(0, 14), 10) || 0 }))
      .filter(n => n.created > 0)
      .sort((a, b) => a.created - b.created);

    if (sorted.length === 0) return;

    _timelineRunning = true;
    const btn = container.querySelector("#og-timeline-btn");
    if (btn) { btn.classList.add("on"); }

    const svgEl = container.querySelector("#og-svg");
    if (!svgEl) return;

    // ── Step 1: hide EVERYTHING immediately ────────────────────────────────
    svgEl.querySelectorAll("circle, path, line, text").forEach(el => {
      el.style.opacity = "0";
      el.style.transition = "none";
    });

    // ── Step 2: build id→nodeGroup map from D3 selection stored in ctx ─────
    // D3 v7 stores data in __data__ property directly on DOM elements
    const nodeIdToGroup = new Map();
    // The node groups are <g> elements inside the nodes <g>
    svgEl.querySelectorAll("g g g").forEach(g => {
      // D3 sets .__data__ directly on the element
      const d = g.__data__;
      if (d && d.id && !nodeIdToGroup.has(d.id)) {
        nodeIdToGroup.set(d.id, g);
      }
    });

    // Also try the ctx nodeG selection from D3
    const ctx = container.__ogCtx;
    if (ctx && ctx.nodeG) {
      ctx.nodeG.each(function(d) {
        if (d && d.id) nodeIdToGroup.set(d.id, this);
      });
    }

    // ── Step 3: build edge list with source/target ids ──────────────────────
    const edgeData = [];
    svgEl.querySelectorAll("g g line").forEach(line => {
      const d = line.__data__;
      if (!d) return;
      const si = d.source?.id || d.source;
      const ti = d.target?.id || d.target;
      if (si && ti) edgeData.push({ el: line, si, ti });
    });

    // ── Step 4: schedule node reveals ──────────────────────────────────────
    const totalDuration = 45000; // 45s — slow reveal, oldest to newest
    const minDate = sorted[0].created;
    const maxDate = sorted[sorted.length - 1].created;
    const dateRange = maxDate - minDate || 1;
    const revealedIds = new Set();
    const startTime = performance.now();

    const step = (now) => {
      if (!_timelineRunning) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / totalDuration, 1);

      // Update button fill
      if (btn) {
        const pct = Math.round(progress * 100);
        btn.style.backgroundImage =
          `linear-gradient(to right, var(--b3-theme-primary) ${pct}%, transparent ${pct}%)`;
        btn.style.color = pct > 50 ? "#fff" : "";
      }

      // Current date cutoff
      const cutoff = minDate + dateRange * progress;

      // Reveal nodes up to cutoff
      sorted.forEach(n => {
        if (n.created > cutoff || revealedIds.has(n.id)) return;
        revealedIds.add(n.id);

        const g = nodeIdToGroup.get(n.id);
        if (g) {
          // Fade in with a quick pop
          g.querySelectorAll("circle, path").forEach(el => {
            el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
            el.style.opacity = "1";
          });
          // Show label if titles are on
          g.querySelectorAll("text").forEach(el => {
            el.style.opacity = showTitles ? "1" : "0";
            el.style.transition = "opacity 0.3s ease";
          });
          // Brief glow flash
          const shape = g.querySelector("circle, path");
          if (shape) {
            shape.style.filter = "brightness(2.5) drop-shadow(0 0 6px currentColor)";
            setTimeout(() => { if (shape) shape.style.filter = ""; }, 400);
          }
        }
      });

      // Reveal edges whose both endpoints are already revealed
      edgeData.forEach(({ el, si, ti }) => {
        if (revealedIds.has(si) && revealedIds.has(ti) && el.style.opacity !== "1") {
          el.style.transition = "opacity 0.5s ease";
          el.style.opacity = showArrows ? "1" : "0.4";
          if (!showArrows) el.removeAttribute("marker-end");
        }
      });

      if (progress < 1) {
        _timelineRaf = requestAnimationFrame(step);
      } else {
        // Done — wait 1s then restore and stop
        _timelineTimer = setTimeout(() => stopTimeline(), 1000);
      }
    };

    _timelineRaf = requestAnimationFrame(step);
  }

  // Wire timeline button
  const timelineBtn = container.querySelector("#og-timeline-btn");
  if (timelineBtn) {
    timelineBtn.addEventListener("click", () => {
      // Access current nodes from ctx (updated after each draw)
      const ctx2 = container.__ogCtx;
      startTimeline(ctx2?.nodes || [], ctx2?.edges || []);
    });
  }
}
var I18N = {
  en: {
    title: "RedStone Graph View",
    settings: "Settings",
    close: "Close",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit Fullscreen",
    settingsTitle: "RedStone Graph View \u2014 Settings",
    langLabel:
      "Language / \u8BED\u8A00 / Idioma / Langue / \u042F\u0437\u044B\u043A",
    search: "Search\u2026",
    reload: "Reload",
    titles: "Titles",
    arrows: "Arrows",
    dist: "Dist",
    cluster: "Cluster",
    repulsion: "Repulsion",
    loading: "Loading\u2026",
    isolated: "isolated",
    db: "DB",
    settingsSection: "General Settings",
    localGraph: "Local Graph",
    localGraphTip: "Show only current page connections",
    timeline: "Timeline", timelineTip: "Animate graph by creation date",
    timeline: "Timeline", timelineTip: "Animate graph by page creation date",
    barPosition: "Button position",
    barTop: "Top bar",
    barRight: "Right sidebar",
    barBoth: "Both",
    hideNativeGraphs: "Disable native SiYuan Graph View and Global Graph",
    useAltG: "Use Alt+G shortcut (requires reload)",
    pin: "Pin panel position and size",
    yes: "Yes",
    no: "No",
    maximize: "Maximize",
    minimize: "Minimize",
  },
  zh: {
    title: "RedStone \u56FE\u8C31\u89C6\u56FE",
    settings: "\u8BBE\u7F6E",
    close: "\u5173\u95ED",
    fullscreen: "\u5168\u5C4F",
    exitFullscreen: "\u9000\u51FA\u5168\u5C4F",
    settingsTitle: "RedStone \u56FE\u8C31\u89C6\u56FE \u2014 \u8BBE\u7F6E",
    langLabel:
      "\u8BED\u8A00 / Language / Idioma / Langue / \u042F\u0437\u044B\u043A",
    search: "\u641C\u7D22\u2026",
    reload: "\u5237\u65B0",
    titles: "\u6807\u9898",
    arrows: "\u7BAD\u5934",
    dist: "\u8DDD\u79BB",
    cluster: "\u805A\u7C7B",
    repulsion: "\u6392\u65A5",
    loading: "\u52A0\u8F7D\u4E2D\u2026",
    isolated: "\u5B64\u7ACB",
    db: "\u6570\u636E\u5E93",
    settingsSection: "\u5E38\u89C4\u8BBE\u7F6E",
    localGraph: "\u672C\u5730\u56FE\u8C31",
    localGraphTip:
      "\u4EC5\u663E\u793A\u5F53\u524D\u9875\u9762\u7684\u8FDE\u63A5",
    timeline: "\u65F6\u95F4\u8F74", timelineTip: "\u6309\u9875\u9762\u521B\u5EFA\u65E5\u671F\u52A8\u753B",
    barPosition: "\u6309\u94AE\u4F4D\u7F6E",
    barTop: "\u9876\u680F",
    barRight: "\u53F3\u4FA7\u680F",
    barBoth: "\u4E24\u8005",
    hideNativeGraphs: "\u7981\u7528\u539F\u751F\u56FE\u8C31\u89C6\u56FE\u548C\u5168\u5C40\u56FE\u8C31",
    useAltG: "\u4F7F\u7528 Alt+G \u5FEB\u6377\u952E\uFF08\u9700\u8981\u91CD\u8F7D\uFF09",
    pin: "\u56FA\u5B9A\u9762\u677F\u4F4D\u7F6E\u548C\u5927\u5C0F",
    yes: "\u662F",
    no: "\u5426",
    maximize: "\u6700\u5927\u5316",
    minimize: "\u6700\u5C0F\u5316",
  },
  pt: {
    title: "RedStone Graph View",
    settings: "Configura\xE7\xF5es",
    close: "Fechar",
    fullscreen: "Tela cheia",
    exitFullscreen: "Sair da tela cheia",
    settingsTitle: "RedStone Graph View \u2014 Configura\xE7\xF5es",
    langLabel:
      "Idioma / Language / \u8BED\u8A00 / Langue / \u042F\u0437\u044B\u043A",
    search: "Buscar\u2026",
    reload: "Recarregar",
    titles: "T\xEDtulos",
    arrows: "Setas",
    dist: "Dist",
    cluster: "Cluster",
    repulsion: "Repuls\xE3o",
    loading: "Carregando\u2026",
    isolated: "isolados",
    db: "BD",
    settingsSection: "Configura\xE7\xF5es Gerais",
    localGraph: "Grafo Local",
    localGraphTip: "Mostrar apenas conex\xF5es da p\xE1gina atual",
    timeline: "Linha do tempo", timelineTip: "Animar grafo por data de cria\xE7\xE3o",
    barPosition: "Posi\xE7\xE3o do bot\xE3o",
    barTop: "Barra superior",
    barRight: "Barra lateral direita",
    barBoth: "Ambos",
    hideNativeGraphs: "Desativar Graph View e Global Graph nativos",
    useAltG: "Usar atalho Alt+G (requer recarregar)",
    pin: "Fixar posição e tamanho do painel",
    yes: "Sim",
    no: "Não",
    maximize: "Maximizar",
    minimize: "Minimizar",
  },
  es: {
    title: "RedStone Vista de Grafo",
    settings: "Configuraci\xF3n",
    close: "Cerrar",
    fullscreen: "Pantalla completa",
    exitFullscreen: "Salir de pantalla completa",
    settingsTitle: "RedStone Vista de Grafo \u2014 Configuraci\xF3n",
    langLabel:
      "Idioma / Language / \u8BED\u8A00 / Langue / \u042F\u0437\u044B\u043A",
    search: "Buscar\u2026",
    reload: "Recargar",
    titles: "T\xEDtulos",
    arrows: "Flechas",
    dist: "Dist",
    cluster: "Cl\xFAster",
    repulsion: "Repulsi\xF3n",
    loading: "Cargando\u2026",
    isolated: "aislados",
    db: "BD",
    settingsSection: "Configuraci\xF3n General",
    localGraph: "Grafo Local",
    localGraphTip: "Mostrar solo las conexiones de la p\xE1gina actual",
    timeline: "Cronolog\xEDa", timelineTip: "Animar grafo por fecha de creaci\xF3n",
    barPosition: "Posici\xF3n del bot\xF3n",
    barTop: "Barra superior",
    barRight: "Barra lateral derecha",
    barBoth: "Ambos",
    hideNativeGraphs: "Desactivar Graph View y Global Graph nativos",
    useAltG: "Usar atajo Alt+G (requiere recargar)",
    pin: "Fijar posición y tamaño del panel",
    yes: "Sí",
    no: "No",
    maximize: "Maximizar",
    minimize: "Minimizar",
  },
  ru: {
    title: "RedStone \u0413\u0440\u0430\u0444",
    settings: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    close: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C",
    fullscreen:
      "\u041F\u043E\u043B\u043D\u044B\u0439 \u044D\u043A\u0440\u0430\u043D",
    exitFullscreen:
      "\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u043F\u043E\u043B\u043D\u043E\u0433\u043E \u044D\u043A\u0440\u0430\u043D\u0430",
    settingsTitle:
      "RedStone \u0413\u0440\u0430\u0444 \u2014 \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    langLabel:
      "\u042F\u0437\u044B\u043A / Language / \u8BED\u8A00 / Idioma / Langue",
    search: "\u041F\u043E\u0438\u0441\u043A\u2026",
    reload: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C",
    titles: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
    arrows: "\u0421\u0442\u0440\u0435\u043B\u043A\u0438",
    dist: "\u0420\u0430\u0441\u0441\u0442",
    cluster: "\u041A\u043B\u0430\u0441\u0442\u0435\u0440",
    repulsion: "\u041E\u0442\u0442\u0430\u043B\u043A",
    loading: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026",
    isolated: "\u0438\u0437\u043E\u043B\u0438\u0440",
    db: "\u0411\u0414",
    settingsSection:
      "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    localGraph:
      "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u0433\u0440\u0430\u0444",
    localGraphTip:
      "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u044F\u0437\u0438 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B",
    timeline: "\u0425\u0440\u043E\u043D\u043E\u043B\u043E\u0433\u0438\u044F", timelineTip: "\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F \u043F\u043E \u0434\u0430\u0442\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F",
    barPosition:
      "\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u043A\u043D\u043E\u043F\u043A\u0438",
    barTop:
      "\u0412\u0435\u0440\u0445\u043D\u044F\u044F \u043F\u0430\u043D\u0435\u043B\u044C",
    barRight:
      "\u041F\u0440\u0430\u0432\u0430\u044F \u043F\u0430\u043D\u0435\u043B\u044C",
    barBoth: "\u041E\u0431\u0430",
    hideNativeGraphs: "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u043E\u0434\u043D\u043E\u0439 Graph View \u0438 Global Graph",
    useAltG: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C Alt+G (\u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430)",
    pin: "\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438 \u0440\u0430\u0437\u043C\u0435\u0440 \u043F\u0430\u043D\u0435\u043B\u0438",
    yes: "\u0414\u0430",
    no: "\u041D\u0435\u0442",
    maximize: "\u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C",
    minimize: "\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C",
  },
};
var LANG_OPTIONS = [
  { code: "en", label: "English" },
  { code: "zh", label: "\u4E2D\u6587" },
  { code: "pt", label: "Portugu\xEAs" },
  { code: "es", label: "Espa\xF1ol" },
  { code: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439" },
];
var RedStoneGraphPlugin = class extends import_siyuan.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "_panel", null);
    __publicField(this, "_settingsPanel", null);
    __publicField(this, "_lang", "pt");
    __publicField(this, "_barPosition", "top");
    // default = top bar only
    __publicField(this, "_topBarBtn", null);
    __publicField(this, "_rightBarBtn", null);
    __publicField(this, "_hideNativeGraphs", true);
    __publicField(this, "_useAltG", true);
    __publicField(this, "_nativeGraphStyle", null);
    __publicField(this, "_isFullscreen", false);
    __publicField(this, "_pinData", null);
    __publicField(this, "_preFsPos", null);
    __publicField(this, "_fsAnimId", null);
    __publicField(this, "_isMinimized", false);
    __publicField(this, "_preMinPos", null);
    __publicField(this, "_lastPos", null);
    __publicField(this, "_showTitles", true);
    __publicField(this, "_showArrows", true);
    __publicField(this, "_params", { dist: 140, cluster: 30, charge: 200 });
  }
  async onload() {
    try {
      const saved = await this.loadData();
      if (saved?.lang && I18N[saved.lang]) this._lang = saved.lang;
      if (saved?.barPosition) {
        if (saved.barPosition === "left") {
          this._barPosition = "right";
          this.saveData({
            lang: this._lang,
            barPosition: "right",
          });
        } else {
          this._barPosition = saved.barPosition;
        }
      }
      if (saved?.hideNativeGraphs !== undefined) this._hideNativeGraphs = saved.hideNativeGraphs;
      if (saved?.useAltG !== undefined) this._useAltG = saved.useAltG;
      if (saved?.pinData) this._pinData = saved.pinData;
      if (saved?.lastPos) this._lastPos = saved.lastPos;
      if (saved?.showTitles !== undefined) this._showTitles = saved.showTitles;
      if (saved?.showArrows !== undefined) this._showArrows = saved.showArrows;
      if (saved?.params) this._params = { ...this._params, ...saved.params };
    } catch (_) {}
    this._applyHideNativeGraphs();
    this.addIcons(`<symbol id="iconRedStoneGraph" viewBox="0 0 16 16">
<circle cx="3" cy="11" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="13" cy="3" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
<circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
<line x1="4.3" y1="9.8" x2="6.7" y2="9.2" stroke="currentColor" stroke-width="1.2"/>
<line x1="9.3" y1="7.3" x2="11.7" y2="4.2" stroke="currentColor" stroke-width="1.2"/>
</symbol><symbol id="iconPin" viewBox="0 0 16 16">
<path d="M8 1C5.2 1 3 3.2 3 6c0 3.5 5 9 5 9s5-5.5 5-9c0-2.8-2.2-5-5-5zm0 5.5c-.8 0-1.5-.7-1.5-1.5S7.2 3.5 8 3.5s1.5.7 1.5 1.5S8.8 6.5 8 6.5z" fill="currentColor"/>
</symbol><symbol id="iconSettings" viewBox="0 0 16 16">
<circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
<line x1="8" y1="2.5" x2="8" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
<line x1="8" y1="11" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
<line x1="2.5" y1="8" x2="5" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
<line x1="11" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</symbol>`);
    if (!document.getElementById("og-anim-style")) {
      const as = document.createElement("style");
      as.id = "og-anim-style";
      as.textContent =
        "@keyframes og-scale-in{0%{opacity:0;transform:scale(0.92) translateY(-10px)}100%{opacity:1;transform:scale(1) translateY(0)}}@keyframes og-scale-out{0%{opacity:1;transform:scale(1) translateY(0)}100%{opacity:0;transform:scale(0.92) translateY(-10px)}}.og-anim-in{animation:og-scale-in .25s ease both}.og-anim-out{animation:og-scale-out .2s ease both}";
      document.head.appendChild(as);
    }
    this._keydownHandler = (e) => {
      if (!e.repeat) {
        const match = this._useAltG
          ? e.altKey && !e.shiftKey && e.key.toLowerCase() === "g"
          : e.altKey && e.shiftKey && e.key.toLowerCase() === "g";
        if (match) {
          e.preventDefault();
          e.stopPropagation();
          this._openFloating();
        }
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === "f" && this._panel && this._panel.style.display !== "none") {
          e.preventDefault();
          e.stopPropagation();
          this._toggleFullscreen();
        }
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === "m" && this._panel && this._panel.style.display !== "none") {
          e.preventDefault();
          e.stopPropagation();
          this._toggleMaximizeMinimize();
        }
      }
    };
    document.addEventListener("keydown", this._keydownHandler, true);
    try {
      const setting = new import_siyuan.Setting({
        confirmCallback: () => {},
      });
      const flags = {
        en: "\u{1F1EC}\u{1F1E7}",
        zh: "\u{1F1E8}\u{1F1F3}",
        pt: "\u{1F1E7}\u{1F1F7}",
        es: "\u{1F1EA}\u{1F1F8}",
        ru: "\u{1F1F7}\u{1F1FA}",
      };
      setting.addItem({
        title:
          "Language / \u8BED\u8A00 / Idioma / Langue / \u042F\u0437\u044B\u043A",
        description:
          "Interface language \xB7 \u754C\u9762\u8BED\u8A00 \xB7 Idioma de la interfaz",
        createActionElement: () => {
          const sel = document.createElement("select");
          sel.style.cssText =
            "padding:4px 8px;border-radius:6px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
          LANG_OPTIONS.forEach(({ code, label }) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = `${flags[code]} ${label}`;
            if (code === this._lang) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", () => this._setLang(sel.value));
          return sel;
        },
      });
      setting.addItem({
        title:
          "Button position \xB7 \u6309\u94AE\u4F4D\u7F6E \xB7 Posi\xE7\xE3o do bot\xE3o \xB7 Posici\xF3n \xB7 \u041F\u043E\u0437\u0438\u0446\u0438\u044F",
        description:
          "Where the Graph View button appears \xB7 \u6309\u94AE\u663E\u793A\u4F4D\u7F6E",
        createActionElement: () => {
          const sel = document.createElement("select");
          sel.style.cssText =
            "padding:4px 8px;border-radius:6px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
          const positions = [
            { code: "top", label: I18N[this._lang]?.barTop || "Top bar" },
            { code: "right", label: I18N[this._lang]?.barRight || "Right sidebar" },
            { code: "both", label: I18N[this._lang]?.barBoth || "Both" },
          ];
          positions.forEach(({ code, label }) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = label;
            if (code === this._barPosition) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", () => this._setBarPosition(sel.value));
          return sel;
        },
      });
      setting.addItem({
        title:
          "Hide native graphs \xB7 隐藏原生图谱 \xB7 Desativar graphos nativos \xB7 Desactivar grafos nativos",
        description:
          "Hide SiYuan's built-in Graph View and Global Graph from the right sidebar",
        createActionElement: () => {
          const sel = document.createElement("select");
          sel.style.cssText =
            "padding:4px 8px;border-radius:6px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
          const opts = [
            { code: "no", label: this.t("no") },
            { code: "yes", label: this.t("yes") },
          ];
          opts.forEach(({ code, label }) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = label;
            if ((code === "yes" && this._hideNativeGraphs) || (code === "no" && !this._hideNativeGraphs))
              opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", () => this._setHideNativeGraphs(sel.value === "yes"));
          return sel;
        },
      });
      setting.addItem({
        title:
          "Use Alt+G \xB7 使用 Alt+G \xB7 Usar Alt+G \xB7 Usar Alt+G",
        description:
          "Switch shortcut from Alt+Shift+G to Alt+G (requires reload to take effect)",
        createActionElement: () => {
          const sel = document.createElement("select");
          sel.style.cssText =
            "padding:4px 8px;border-radius:6px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
          const opts = [
            { code: "no", label: this.t("no") + " (Alt+Shift+G)" },
            { code: "yes", label: this.t("yes") + " (Alt+G)" },
          ];
          opts.forEach(({ code, label }) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = label;
            if ((code === "yes" && this._useAltG) || (code === "no" && !this._useAltG))
              opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", () => this._setUseAltG(sel.value === "yes"));
          return sel;
        },
      });
      setting.addItem({
        title: "Maximize/Minimize \xB7 最大化/最小化 \xB7 Maximizar/Minimizar \xB7 Maximizar/Minimizar \xB7 Развернуть/Свернуть",
        description: "Alt+Shift+M — Toggle maximize/minimize the graph panel",
        createActionElement: () => {
          const span = document.createElement("span");
          span.style.cssText =
            "padding:4px 8px;font-size:13px;color:var(--b3-theme-on-surface);opacity:.8;";
          span.textContent = "Alt+Shift+M";
          return span;
        },
      });
      this.setting = setting;
    } catch (_) {}
  }
  onLayoutReady() {
    this._injectRightBarButton();
    this._applyBarPosition();
  }
  t(key) {
    return I18N[this._lang]?.[key] || I18N["en"][key] || key;
  }
  async _savePrefs() {
    try {
      await this.saveData({
        lang: this._lang,
        barPosition: this._barPosition,
        hideNativeGraphs: this._hideNativeGraphs,
        useAltG: this._useAltG,
        pinData: this._pinData,
        lastPos: this._lastPos,
        showTitles: this._showTitles,
        showArrows: this._showArrows,
        params: this._params,
      });
    } catch (_) {}
  }
  async _setBarPosition(pos) {
    this._barPosition = pos;
    await this._savePrefs();
    this._applyBarPosition();
  }
  _applyBarPosition() {
    if (this._topBarBtn) {
      try {
        this._topBarBtn.remove?.();
      } catch (_) {}
      this._topBarBtn = null;
    }
    if (this._barPosition === "top" || this._barPosition === "both") {
      this._topBarBtn = this.addTopBar({
        icon: "iconRedStoneGraph",
        title: "RedStone Graph View",
        callback: () => this._handleOpen(),
      });
    }
    // Toggle right sidebar button visibility
    if (this._rightBarBtn) {
      this._rightBarBtn.style.display =
        this._barPosition === "right" || this._barPosition === "both"
          ? ""
          : "none";
    }
  }
  async _setHideNativeGraphs(val) {
    this._hideNativeGraphs = val;
    await this._savePrefs();
    this._applyHideNativeGraphs();
  }
  async _setUseAltG(val) {
    this._useAltG = val;
    await this._savePrefs();
  }
  _applyHideNativeGraphs() {
    if (this._hideNativeGraphs) {
      if (!this._nativeGraphStyle) {
        const style = document.createElement("style");
        style.id = "og-hide-native-graphs";
        style.textContent =
          '[data-type="graph"],[data-type="globalGraph"]{display:none!important}';
        document.head.appendChild(style);
        this._nativeGraphStyle = style;
      }
    } else {
      if (this._nativeGraphStyle) {
        this._nativeGraphStyle.remove();
        this._nativeGraphStyle = null;
      }
    }
  }
  _toggleFullscreen() {
    const panel = this._panel;
    if (!panel || panel.style.display === "none") return;
    if (this._isMinimized) this._restoreFromMinimized();
    this._isFullscreen = !this._isFullscreen;
    const btn = panel.querySelector("#og-fs");
    const body = this._graphBody;
    const wrap = body?.querySelector(".og-wrap");
    // ctx is stored on wrap (set during draw) or on body as fallback
    const ctx = wrap?.__ogCtx || body?.__ogCtx;
    const svgNode = ctx?.svg?.node();

    // Save pre-fs position when entering fullscreen
    if (this._isFullscreen) {
      const cs = getComputedStyle(panel);
      this._preFsPos = {
        top: panel.style.top || cs.top,
        left: panel.style.left || cs.left,
        right: panel.style.right || cs.right,
        bottom: panel.style.bottom || cs.bottom,
        width: panel.style.width || cs.width,
        height: panel.style.height || cs.height,
        borderRadius: panel.style.borderRadius || cs.borderRadius,
      };
    }

    // Cancel any running animation
    if (this._fsAnimId) {
      cancelAnimationFrame(this._fsAnimId);
      this._fsAnimId = null;
    }

    // Measure current state BEFORE any style changes
    const startRect = panel.getBoundingClientRect();
    const startWrapW = wrap?.clientWidth || startRect.width;
    const startWrapH = wrap?.clientHeight || startRect.height;

    // Temporarily apply target styles to measure final dimensions
    const savedTrans = panel.style.transition;
    const savedStyles = {
      width: panel.style.width,
      height: panel.style.height,
      top: panel.style.top,
      left: panel.style.left,
      right: panel.style.right,
      bottom: panel.style.bottom,
      borderRadius: panel.style.borderRadius,
    };
    panel.style.transition = "none";
    if (this._isFullscreen) {
      panel.style.top = "0"; panel.style.left = "0";
      panel.style.right = "0"; panel.style.bottom = "0";
      panel.style.width = "100vw"; panel.style.height = "100vh";
      panel.style.borderRadius = "0";
    } else {
      const prev = this._preFsPos || {};
      panel.style.top = prev.top || "50px";
      panel.style.left = prev.left || "";
      panel.style.right = prev.right || "16px";
      panel.style.bottom = prev.bottom || "";
      panel.style.width = prev.width || "540px";
      panel.style.height = prev.height || "700px";
      panel.style.borderRadius = prev.borderRadius || "10px";
    }
    void wrap?.offsetWidth; // force reflow to get final layout
    const endRect = panel.getBoundingClientRect();
    const endWrapW = wrap?.clientWidth || endRect.width;
    const endWrapH = wrap?.clientHeight || endRect.height;
    // Restore panel to starting state (no visual flash — all synchronous)
    Object.assign(panel.style, savedStyles);
    panel.style.transition = savedTrans;
    void wrap?.offsetWidth;

    // Update button text
    if (btn) btn.textContent = this._isFullscreen ? "⊡" : "⛶";

    // Fallback: no D3 context or no size change, snap directly
    if (!ctx || !svgNode || !wrap || !ctx.d3 ||
        (startWrapW === endWrapW && startWrapH === endWrapH)) {
      panel.style.transition = "";
      if (this._isFullscreen) {
        Object.assign(panel.style, {
          top: "0", left: "0", right: "0", bottom: "0",
          width: "100vw", height: "100vh", borderRadius: "0", zIndex: "9999",
        });
      } else {
        const prev = this._preFsPos || {};
        Object.assign(panel.style, {
          top: prev.top || "50px", left: prev.left || "",
          right: prev.right || "16px", bottom: prev.bottom || "",
          width: prev.width || "540px", height: prev.height || "700px",
          borderRadius: prev.borderRadius || "10px", zIndex: "9998",
        });
      }
      return;
    }

    // Capture original D3 zoom transform (constant base during animation)
    const originalTf = ctx.d3.zoomTransform(svgNode);

    // Pixel values for animation interpolation
    const startL = startRect.left, startT = startRect.top;
    const endL = endRect.left, endT = endRect.top;
    const startPW = startRect.width, startPH = startRect.height;
    const endPW = endRect.width, endPH = endRect.height;
    const startBR = parseFloat(savedStyles.borderRadius) || 10;
    const endBR = this._isFullscreen ? 0 : (parseFloat(this._preFsPos?.borderRadius) || 10);

    const duration = 300;
    const startTime = performance.now();

    const animate = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      // Interpolate panel bounding rect + border-radius
      const pw = startPW + (endPW - startPW) * ease;
      const ph = startPH + (endPH - startPH) * ease;
      const pl = startL + (endL - startL) * ease;
      const pt = startT + (endT - startT) * ease;
      const br = startBR + (endBR - startBR) * ease;

      // Update panel style for this frame
      panel.style.left = pl + "px";
      panel.style.top = pt + "px";
      panel.style.width = pw + "px";
      panel.style.height = ph + "px";
      panel.style.right = "";
      panel.style.bottom = "";
      panel.style.borderRadius = br + "px";

      // Read actual wrap size after layout settles (forces reflow)
      const curWrapW = wrap.clientWidth;
      const curWrapH = wrap.clientHeight;

      // Adjust D3 zoom so same data point stays at viewport center
      const dx = (curWrapW - startWrapW) / 2;
      const dy = (curWrapH - startWrapH) / 2;
      const nt = originalTf.translate(dx, dy);
      ctx.gRoot.attr("transform", nt.toString());
      ctx.svg.property("__zoom", nt);

      if (t < 1) {
        this._fsAnimId = requestAnimationFrame(animate);
      } else {
        // Finalize: restore exact target style strings
        if (this._isFullscreen) {
          Object.assign(panel.style, {
            top: "0", left: "0", right: "0", bottom: "0",
            width: "100vw", height: "100vh",
            borderRadius: "0", zIndex: "9999",
          });
        } else {
          const prev = this._preFsPos || {};
          Object.assign(panel.style, {
            top: prev.top || "50px",
            left: prev.left || "",
            right: prev.right || "16px",
            bottom: prev.bottom || "",
            width: prev.width || "540px",
            height: prev.height || "700px",
            borderRadius: prev.borderRadius || "10px",
            zIndex: "9998",
          });
        }
        this._fsAnimId = null;
        // After fullscreen animation: force full recenter
        const finalW = wrap.clientWidth;
        const finalH = wrap.clientHeight;
        // wrap._ogRecenter is set by renderGraph
        if (wrap && wrap._ogRecenter) {
          setTimeout(() => wrap._ogRecenter(finalW, finalH), 30);
        } else {
          const finalCtx = wrap?.__ogCtx || body?.__ogCtx;
          if (finalCtx) { finalCtx.W = finalW; finalCtx.H = finalH; }
        }
      }
    };
    this._fsAnimId = requestAnimationFrame(animate);
  }
  _toggleMaximizeMinimize() {
    const panel = this._panel;
    if (!panel || panel.style.display === "none") return;
    // Cycle: minimized → normal → fullscreen → minimized
    if (this._isMinimized) {
      this._restoreFromMinimized();
    } else if (this._isFullscreen) {
      this._toggleFullscreen();
      // After exiting fullscreen, minimize
      setTimeout(() => this._minimize(), 350);
    } else {
      this._minimize();
    }
  }
  _minimize() {
    const panel = this._panel;
    if (!panel || this._isMinimized) return;
    // Exit fullscreen first if needed
    if (this._isFullscreen) {
      this._toggleFullscreen();
      // Wait for fullscreen animation then minimize
      setTimeout(() => this._doMinimize(panel), 350);
    } else {
      this._doMinimize(panel);
    }
  }
  _doMinimize(panel) {
    // Save exact position/size to restore later
    const rect = panel.getBoundingClientRect();
    this._preMinPos = {
      top: panel.style.top || rect.top + "px",
      left: panel.style.left !== "" && panel.style.left !== "auto" ? panel.style.left : "",
      right: panel.style.left !== "" && panel.style.left !== "auto" ? "" : (panel.style.right || "16px"),
      width: rect.width + "px",
      height: rect.height + "px",
    };
    this._isMinimized = true;
    const hdr = panel.firstElementChild;
    const hdrH = hdr ? hdr.offsetHeight : 42;
    // Hide body and handles immediately
    const body = this._graphBody;
    if (body) body.style.display = "none";
    panel.querySelectorAll(".og-rh").forEach((h) => { h.style.display = "none"; });
    // Animate collapse — keep current X/Y position (no snap to corner)
    panel.style.transition = "width .2s ease, height .2s ease, border-radius .2s ease";
    panel.style.width = "240px";
    panel.style.height = hdrH + "px";
    panel.style.borderRadius = "8px";
    panel.style.overflow = "hidden";
    // Buttons
    const fsBtn = panel.querySelector("#og-fs");
    if (fsBtn) { fsBtn.textContent = "⛶"; fsBtn.title = this.t("maximize"); }
    const minBtn = panel.querySelector("#og-min");
    if (minBtn) { minBtn.textContent = "▣"; minBtn.title = this.t("maximize"); }
    // Header: draggable + click to restore
    if (hdr) {
      hdr.style.borderRadius = "8px";
      hdr.style.borderBottom = "none";
      hdr.title = this.t("maximize");
      // Make minimized panel draggable
      let mx = 0, my = 0, mdragging = false;
      hdr._ogMinDragStart = (e) => {
        if (["og-cls","og-fs","og-settings-btn","og-pin-btn","og-min"].includes(e.target.id)) return;
        if (e.button !== 0) return;
        mdragging = true;
        mx = e.clientX - panel.getBoundingClientRect().left;
        my = e.clientY - panel.getBoundingClientRect().top;
        hdr.style.cursor = "grabbing";
        e.preventDefault();
      };
      hdr._ogMinDragMove = (e) => {
        if (!mdragging) return;
        panel.style.left = e.clientX - mx + "px";
        panel.style.top = e.clientY - my + "px";
        panel.style.right = "auto";
      };
      hdr._ogMinDragEnd = (e) => {
        if (!mdragging) return;
        mdragging = false;
        hdr.style.cursor = "grab";
        // If barely moved, treat as click → restore
        const moved = Math.abs(e.clientX - (panel.getBoundingClientRect().left + mx)) +
                      Math.abs(e.clientY - (panel.getBoundingClientRect().top + my));
        if (moved < 5) this._restoreFromMinimized();
      };
      hdr.style.cursor = "grab";
      hdr.addEventListener("mousedown", hdr._ogMinDragStart);
      document.addEventListener("mousemove", hdr._ogMinDragMove);
      document.addEventListener("mouseup", hdr._ogMinDragEnd);
    }
    setTimeout(() => { panel.style.transition = ""; }, 220);
  }
  _restoreFromMinimized() {
    const panel = this._panel;
    if (!panel || !this._isMinimized) return;
    this._isMinimized = false;
    const prev = this._preMinPos || {};
    panel.style.transition = "all .25s ease";
    panel.style.top = prev.top || "50px";
    if (prev.left) {
      panel.style.left = prev.left;
      panel.style.right = "auto";
    } else {
      panel.style.right = prev.right || "16px";
      panel.style.left = "auto";
    }
    panel.style.width = prev.width || "540px";
    panel.style.height = prev.height || "700px";
    panel.style.borderRadius = "10px";
    const body = this._graphBody;
    if (body) body.style.display = "";
    // Only show resize handles if not pinned
    if (!this._pinData?.pinned) {
      const handles = panel.querySelectorAll(".og-rh");
      handles.forEach(function (h) { h.style.display = ""; });
    }
    const titleEl = panel.querySelector("#og-panel-title");
    if (titleEl) titleEl.style.display = "";
    const fsBtn = panel.querySelector("#og-fs");
    if (fsBtn) {
      fsBtn.textContent = "⛶";
      fsBtn.title = this.t("fullscreen");
    }
    const minBtn = panel.querySelector("#og-min");
    if (minBtn) {
      minBtn.textContent = "—";
      minBtn.title = this.t("minimize");
    }
    const hdr = panel.firstElementChild;
    if (hdr) {
      // Remove minimized drag listeners
      if (hdr._ogMinDragStart) { hdr.removeEventListener("mousedown", hdr._ogMinDragStart); hdr._ogMinDragStart = null; }
      if (hdr._ogMinDragMove) { document.removeEventListener("mousemove", hdr._ogMinDragMove); hdr._ogMinDragMove = null; }
      if (hdr._ogMinDragEnd) { document.removeEventListener("mouseup", hdr._ogMinDragEnd); hdr._ogMinDragEnd = null; }
      // Remove restore click listener
      if (hdr._ogRestoreClick) { hdr.removeEventListener("click", hdr._ogRestoreClick); hdr._ogRestoreClick = null; }
      hdr.title = "";
      hdr.style.cursor = this._pinData?.pinned ? "default" : "move";
      hdr.style.borderRadius = "10px 10px 0 0";
      hdr.style.borderBottom = "1px solid var(--b3-border-color)";
      hdr.title = "";
      if (hdr._ogRestoreClick) {
        hdr.removeEventListener("click", hdr._ogRestoreClick);
        delete hdr._ogRestoreClick;
      }
    }
    // Trigger recenter
    setTimeout(() => {
      panel.style.transition = "";
      const body2 = this._graphBody;
      const wrap = body2?.querySelector(".og-wrap");
      if (wrap && wrap._ogRecenter) {
        wrap._ogRecenter(wrap.clientWidth, wrap.clientHeight);
      }
    }, 260);
  }
  _togglePin() {
    const panel = this._panel;
    if (!panel) return;
    const pinned = !this._pinData?.pinned;
    if (pinned) {
      // Save current position and size
      const cs = getComputedStyle(panel);
      this._pinData = {
        pinned: true,
        top: panel.style.top || cs.top,
        left: panel.style.left || cs.left,
        right: panel.style.right || cs.right,
        width: panel.style.width || cs.width,
        height: panel.style.height || cs.height,
      };
      const ico = panel.querySelector("#og-pin-icon");
      if (ico) {
        ico.style.color = "var(--b3-theme-primary)";
        ico.style.opacity = "1";
      }
      // Hide resize handles
      const hdls = panel.querySelectorAll(".og-rh");
      hdls.forEach((h) => { h.style.display = "none"; });
    } else {
      this._pinData = { pinned: false };
      const ico = panel.querySelector("#og-pin-icon");
      if (ico) {
        ico.style.color = "var(--b3-theme-on-surface)";
        ico.style.opacity = ".4";
      }
      // Show resize handles
      const hdls = panel.querySelectorAll(".og-rh");
      hdls.forEach((h) => { h.style.display = ""; });
    }
    this._savePrefs();
  }
  _setupResizeHandles(panel) {
    const MIN_W = 300;
    const MIN_H = 200;
    const makeHandle = (cls, pos, cursor, edges) => {
      const el = document.createElement("div");
      el.className = "og-rh " + cls;
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "auto",
        cursor: cursor,
        zIndex: "10",
        borderRadius: "2px",
      });
      Object.assign(el.style, pos);
      el.addEventListener("mouseenter", () => {
        el.style.background = "var(--b3-theme-primary)";
        el.style.opacity = ".3";
      });
      el.addEventListener("mouseleave", () => {
        el.style.background = "transparent";
        el.style.opacity = "";
      });
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const sTop = panel.offsetTop;
        const sLeft = panel.offsetLeft;
        const sW = panel.offsetWidth;
        const sH = panel.offsetHeight;
        const onMove = (ev) => {
          let dx = ev.clientX - startX;
          let dy = ev.clientY - startY;
          let newTop = sTop;
          let newLeft = sLeft;
          let newW = sW;
          let newH = sH;
          let useLeft = false;
          if (edges.includes("t")) {
            newTop = sTop + dy;
            newH = sH - dy;
          }
          if (edges.includes("b")) {
            newH = sH + dy;
          }
          if (edges.includes("l")) {
            newLeft = sLeft + dx;
            newW = sW - dx;
            useLeft = true;
          }
          if (edges.includes("r")) {
            newW = sW + dx;
          }
          // Clamp minimum size
          if (newW < MIN_W) {
            if (edges.includes("l")) newLeft = sLeft + sW - MIN_W;
            newW = MIN_W;
          }
          if (newH < MIN_H) {
            if (edges.includes("t")) newTop = sTop + sH - MIN_H;
            newH = MIN_H;
          }
          panel.style.width = newW + "px";
          panel.style.height = newH + "px";
          if (edges.includes("t")) panel.style.top = newTop + "px";
          if (useLeft) { panel.style.left = newLeft + "px"; panel.style.right = "auto"; }
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", () => {
          document.removeEventListener("mousemove", onMove);
        }, { once: true });
      });
      return el;
    };
    const handleDefs = [
      ["og-rh-nw", { top: "0", left: "0", width: "10px", height: "10px" }, "nwse-resize", ["t","l"]],
      ["og-rh-n",  { top: "0", left: "10px", right: "10px", height: "5px" }, "ns-resize",    ["t"]],
      ["og-rh-ne", { top: "0", right: "0", width: "10px", height: "10px" }, "nesw-resize",  ["t","r"]],
      ["og-rh-e",  { top: "10px", right: "0", bottom: "10px", width: "5px" }, "ew-resize",   ["r"]],
      ["og-rh-se", { bottom: "0", right: "0", width: "10px", height: "10px" }, "nwse-resize", ["b","r"]],
      ["og-rh-s",  { bottom: "0", left: "10px", right: "10px", height: "5px" }, "ns-resize",  ["b"]],
      ["og-rh-sw", { bottom: "0", left: "0", width: "10px", height: "10px" }, "nesw-resize", ["b","l"]],
      ["og-rh-w",  { top: "10px", left: "0", bottom: "10px", width: "5px" }, "ew-resize",   ["l"]],
    ];
    handleDefs.forEach((d) => {
      panel.appendChild(makeHandle(d[0], d[1], d[2], d[3]));
    });
  }
  async _setLang(code) {
    this._lang = code;
    await this._savePrefs();
    this._applyLangToPanel();
  }
  // Update all visible UI strings without closing/reopening the panel
  _applyLangToPanel() {
    if (!this._panel) return;
    const q = (id) => this._panel.querySelector(id);
    const titleEl = q("#og-panel-title");
    if (titleEl) titleEl.innerHTML = '<span style="color:#e53e3e;letter-spacing:-0.3px">RedStone</span> <span style="font-weight:500;opacity:.85">Graph View</span>';
    const fsEl = q("#og-fs");
    if (fsEl) fsEl.title = this.t("fullscreen");
    const clsEl = q("#og-cls");
    if (clsEl) clsEl.title = this.t("close");
    const settingsEl = q("#og-settings-btn");
    if (settingsEl) settingsEl.title = this.t("settings");
    const minEl = q("#og-min");
    if (minEl) minEl.title = this._isMinimized ? this.t("maximize") : this.t("minimize");
    const body = this._panel.querySelector(".og-root");
    if (!body) return;
    const search = body.querySelector(".og-search");
    if (search) search.placeholder = this.t("search");
    const refresh = body.querySelector("#og-refresh");
    if (refresh) refresh.title = this.t("reload");
    const titlesBtn = body.querySelector("#og-titles-btn");
    if (titlesBtn) titlesBtn.textContent = this.t("titles");
    const arrowsBtn = body.querySelector("#og-arrows-btn");
    if (arrowsBtn) arrowsBtn.textContent = this.t("arrows");
    const localBtn = body.querySelector("#og-local-btn");
    if (localBtn) {
      localBtn.title = this.t("localGraphTip");
      const isOn = localBtn.classList.contains("on");
      localBtn.textContent = "\u2299 " + this.t("localGraph");
      if (isOn) localBtn.classList.add("on");
    }
    const ctrls = body.querySelectorAll(".og-ctrl span:first-child");
    const keys = ["dist", "cluster", "repulsion"];
    ctrls.forEach((el, i) => {
      if (keys[i]) el.textContent = this.t(keys[i]);
    });
  }
  _injectRightBarButton() {
    if (this._rightBarBtn) return;
    const self = this;
    const tryInject = () => {
      if (self._rightBarBtn) return true;
      const container = document.querySelector(
        '[data-type="graph"],[data-type="globalGraph"],[data-type="backlink"]',
      )?.parentNode;
      if (!container) return false;
      const btn = document.createElement("span");
      btn.className = "dock__item";
      btn.title = "RedStone Graph View";
      btn.innerHTML = '<svg><use href="#iconRedStoneGraph"></use></svg>';
      btn.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
          self._openFloating();
        },
        true,
      );
      container.appendChild(btn);
      self._rightBarBtn = btn;
      return true;
    };
    tryInject();
    const obs = new MutationObserver(() => {
      if (!self._rightBarBtn && tryInject()) {
        self._applyBarPosition();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 5e3);
  }
  _handleOpen() {
    this._openFloating();
  }
  _openFloating() {
    if (this._panel) {
      const p = this._panel;
      if (p.style.display === "none") {
        // Show with animation
        if (this._isMinimized) this._restoreFromMinimized();
        p.classList.remove("og-anim-out");
        p.style.display = "flex";
        void p.offsetWidth;
        p.classList.add("og-anim-in");
      } else {
        // Hide with animation
        p.classList.remove("og-anim-in");
        p.classList.add("og-anim-out");
        p.addEventListener("animationend", function _onHideEnd() {
          p.removeEventListener("animationend", _onHideEnd);
          p.style.display = "none";
        });
      }
      return;
    }
    const panel = document.createElement("div");
    this._panel = panel;
    this._isFullscreen = false;
    this._isMinimized = false;
    Object.assign(panel.style, {
      position: "fixed",
      top: "50px",
      right: "16px",
      width: "540px",
      height: "700px",
      background: "var(--b3-theme-background)",
      border: "1px solid var(--b3-border-color)",
      borderRadius: "10px",
      zIndex: "9998",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
      overflow: "hidden",
      opacity: "0",
    });
    // Restore pinned position/size
    if (this._pinData?.pinned) {
      const pd = this._pinData;
      if (pd.top) panel.style.top = pd.top;
      if (pd.left) { panel.style.left = pd.left; panel.style.right = "auto"; }
      else if (pd.right) panel.style.right = pd.right;
      if (pd.width) panel.style.width = pd.width;
      if (pd.height) panel.style.height = pd.height;
    } else if (this._lastPos) {
      const lp = this._lastPos;
      if (lp.top) panel.style.top = lp.top;
      if (lp.left) { panel.style.left = lp.left; panel.style.right = "auto"; }
      else if (lp.right) panel.style.right = lp.right;
      if (lp.width) panel.style.width = lp.width;
      if (lp.height) panel.style.height = lp.height;
    }
    const hdr = document.createElement("div");
    Object.assign(hdr.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "7px 12px",
      borderBottom: "1px solid var(--b3-border-color)",
      cursor: "move",
      flexShrink: "0",
      userSelect: "none",
      background: "var(--b3-theme-surface)",
      borderRadius: "10px 10px 0 0",
    });
    const btnStyle =
      "border:none;background:none;cursor:pointer;font-size:15px;color:var(--b3-theme-on-surface);padding:2px 4px;line-height:1;";
    hdr.innerHTML = `
      <span id="og-panel-title" style="font-size:13px;font-weight:700"><span style="color:#e53e3e;letter-spacing:-0.3px">RedStone</span> <span style="font-weight:500;opacity:.85">Graph View</span></span>
      <div style="display:flex;gap:4px;align-items:center">
        <button id="og-settings-btn" title="${this.t("settings")}" style="${btnStyle}"><svg id="og-settings-icon" width="15" height="15" style="display:block;color:var(--b3-theme-on-surface)"><use href="#iconSettings"></use></svg></button>
        <button id="og-pin-btn" title="${this.t("pin")}" style="${btnStyle}"><svg id="og-pin-icon" width="15" height="15" style="display:block;color:${this._pinData?.pinned ? "var(--b3-theme-primary)" : "var(--b3-theme-on-surface)"};opacity:${this._pinData?.pinned ? "1" : ".4"}"><use href="#iconPin"></use></svg></button>
        <button id="og-fs" title="${this.t("fullscreen")}" style="${btnStyle}">\u26F6</button>
        <button id="og-min" title="${this.t("minimize")}" style="${btnStyle}">\u2014</button>
        <button id="og-cls" title="${this.t("close")}" style="${btnStyle};font-size:17px">\u2715</button>
      </div>`;
    panel.appendChild(hdr);
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow:hidden;min-height:0;";
    panel.appendChild(body);
    this._graphBody = body;
    document.body.appendChild(panel);
    // Trigger open animation
    void panel.offsetWidth;
    panel.classList.add("og-anim-in");
    let ox = 0,
      oy = 0,
      dragging = false;
    hdr.addEventListener("mousedown", (e) => {
      const id = e.target.id;
      if (["og-cls", "og-fs", "og-settings-btn", "og-pin-btn", "og-min"].includes(id)) return;
      if (this._pinData?.pinned) return;
      dragging = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = e.clientX - ox + "px";
      panel.style.right = "auto";
      panel.style.top = e.clientY - oy + "px";
    });
    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        // Save position after drag so it persists on next open
        if (!this._pinData?.pinned && !this._isMinimized && !this._isFullscreen) {
          const rect = panel.getBoundingClientRect();
          this._lastPos = {
            top: panel.style.top,
            left: panel.style.left,
            right: "auto",
            width: rect.width + "px",
            height: rect.height + "px",
          };
          this._savePrefs();
        }
      }
    });
    panel.querySelector("#og-fs").addEventListener("click", () => {
      this._toggleFullscreen();
    });
    panel.querySelector("#og-min").addEventListener("click", () => {
      if (this._isMinimized) {
        this._restoreFromMinimized();
      } else {
        this._minimize();
      }
    });
    panel.querySelector("#og-cls").addEventListener("click", () => {
      if (this._fsAnimId) { cancelAnimationFrame(this._fsAnimId); this._fsAnimId = null; }
      // Restore from minimized before saving position
      if (this._isMinimized) this._restoreFromMinimized();
      const cs = getComputedStyle(panel);
      if (this._pinData?.pinned) {
        this._pinData = {
          pinned: true,
          top: panel.style.top || cs.top,
          left: panel.style.left || cs.left,
          right: panel.style.right || cs.right,
          width: panel.style.width || cs.width,
          height: panel.style.height || cs.height,
        };
      } else {
        this._lastPos = {
          top: panel.style.top || cs.top,
          left: panel.style.left || cs.left,
          right: panel.style.right || cs.right,
          width: panel.style.width || cs.width,
          height: panel.style.height || cs.height,
        };
      }
      this._savePrefs();
      panel.classList.remove("og-anim-in");
      panel.classList.add("og-anim-out");
      panel.addEventListener("animationend", function _onCloseEnd() {
        panel.removeEventListener("animationend", _onCloseEnd);
        panel.style.display = "none";
      });
    });
    panel.querySelector("#og-pin-btn").addEventListener("click", () => {
      this._togglePin();
    });
    panel.querySelector("#og-settings-btn").addEventListener("click", () => {
      this._openSettings();
    });
    renderGraph(body, this._lang, this._showTitles, this._showArrows, this, this._params);
    this._setupResizeHandles(panel);
    // Hide handles if pinned
    if (this._pinData?.pinned) {
      const hdls = panel.querySelectorAll(".og-rh");
      hdls.forEach((h) => { h.style.display = "none"; });
    }
  }
  // ── Settings panel ────────────────────────────────────────────────────────
  _updateSettingsIcon(active) {
    const ico = document.getElementById("og-settings-icon");
    if (ico) {
      ico.style.color = active ? "var(--b3-theme-primary)" : "var(--b3-theme-on-surface)";
    }
  }
  _openSettings() {
    if (this._settingsPanel) {
      this._settingsPanel.remove();
      this._settingsPanel = null;
      this._updateSettingsIcon(false);
      return;
    }
    this._updateSettingsIcon(true);
    const sp = document.createElement("div");
    this._settingsPanel = sp;
    Object.assign(sp.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      width: "360px",
      background: "var(--b3-theme-background)",
      border: "1px solid var(--b3-border-color)",
      borderRadius: "12px",
      zIndex: "10000",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      overflow: "hidden",
    });
    const sh = document.createElement("div");
    Object.assign(sh.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      borderBottom: "1px solid var(--b3-border-color)",
      background: "var(--b3-theme-surface)",
    });
    sh.innerHTML = `
      <span style="font-size:14px;font-weight:600">\u2699\uFE0F ${this.t("settingsTitle")}</span>
      <button id="og-sp-cls" style="border:none;background:none;cursor:pointer;font-size:17px;color:var(--b3-theme-on-surface)">\u2715</button>`;
    sp.appendChild(sh);
    const sb = document.createElement("div");
    sb.style.cssText =
      "padding:20px 16px;display:flex;flex-direction:column;gap:16px;";
    const langSection = document.createElement("div");
    langSection.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    const langLabel = document.createElement("div");
    langLabel.style.cssText =
      "font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.05em;";
    langLabel.textContent = this.t("langLabel");
    langSection.appendChild(langLabel);
    const langSelect = document.createElement("select");
    langSelect.style.cssText =
      "padding:6px 10px;border-radius:8px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
    LANG_OPTIONS.forEach(({ code, label }) => {
      const opt = document.createElement("option");
      opt.value = code;
      const flagMap = {
        en: "\u{1F1EC}\u{1F1E7}",
        zh: "\u{1F1E8}\u{1F1F3}",
        pt: "\u{1F1E7}\u{1F1F7}",
        es: "\u{1F1EA}\u{1F1F8}",
        ru: "\u{1F1F7}\u{1F1FA}",
      };
      opt.textContent = (flagMap[code] || "") + " " + label;
      if (code === this._lang) opt.selected = true;
      langSelect.appendChild(opt);
    });
    langSelect.addEventListener("change", async () => {
      await this._setLang(langSelect.value);
      sp.remove();
      this._settingsPanel = null;
      this._openSettings();
    });
    langSection.appendChild(langSelect);
    sb.appendChild(langSection);
    const barSection = document.createElement("div");
    barSection.style.cssText =
      "display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--b3-border-color);padding-top:14px;";
    const barLabel = document.createElement("div");
    barLabel.style.cssText =
      "font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.05em;";
    barLabel.textContent = this.t("barPosition");
    barSection.appendChild(barLabel);
    const barSelect = document.createElement("select");
    barSelect.style.cssText =
      "padding:6px 10px;border-radius:8px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
    const barOpts = [
      { code: "top", labelKey: "barTop" },
      { code: "right", labelKey: "barRight" },
      { code: "both", labelKey: "barBoth" },
    ];
    barOpts.forEach(({ code, labelKey }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = this.t(labelKey);
      if (code === this._barPosition) opt.selected = true;
      barSelect.appendChild(opt);
    });
    barSelect.addEventListener("change", async () => {
      await this._setBarPosition(barSelect.value);
      sp.remove();
      this._settingsPanel = null;
      this._openSettings();
    });
    barSection.appendChild(barSelect);
    sb.appendChild(barSection);
    // Hide native graphs toggle
    const hideSection = document.createElement("div");
    hideSection.style.cssText =
      "display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--b3-border-color);padding-top:14px;";
    const hideLabel = document.createElement("div");
    hideLabel.style.cssText =
      "font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.05em;";
    hideLabel.textContent = this.t("hideNativeGraphs");
    hideSection.appendChild(hideLabel);
    const hideSelect = document.createElement("select");
    hideSelect.style.cssText =
      "padding:6px 10px;border-radius:8px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
    [
      { code: "no", label: this.t("no") },
      { code: "yes", label: this.t("yes") },
    ].forEach(({ code, label }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      if ((code === "yes" && this._hideNativeGraphs) || (code === "no" && !this._hideNativeGraphs))
        opt.selected = true;
      hideSelect.appendChild(opt);
    });
    hideSelect.addEventListener("change", async () => {
      await this._setHideNativeGraphs(hideSelect.value === "yes");
      sp.remove();
      this._settingsPanel = null;
      this._openSettings();
    });
    hideSection.appendChild(hideSelect);
    sb.appendChild(hideSection);
    // Use Alt+G toggle
    const altSection = document.createElement("div");
    altSection.style.cssText =
      "display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--b3-border-color);padding-top:14px;";
    const altLabel = document.createElement("div");
    altLabel.style.cssText =
      "font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.05em;";
    altLabel.textContent = this.t("useAltG");
    altSection.appendChild(altLabel);
    const altSelect = document.createElement("select");
    altSelect.style.cssText =
      "padding:6px 10px;border-radius:8px;font-size:13px;border:1.5px solid var(--b3-theme-primary);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);cursor:pointer;";
    [
      { code: "no", label: this.t("no") + " (Alt+Shift+G)" },
      { code: "yes", label: this.t("yes") + " (Alt+G)" },
    ].forEach(({ code, label }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      if ((code === "yes" && this._useAltG) || (code === "no" && !this._useAltG))
        opt.selected = true;
      altSelect.appendChild(opt);
    });
    altSelect.addEventListener("change", async () => {
      await this._setUseAltG(altSelect.value === "yes");
      sp.remove();
      this._settingsPanel = null;
      this._openSettings();
    });
    altSection.appendChild(altSelect);
    sb.appendChild(altSection);
    // Maximize/Minimize shortcut info
    const maxSection = document.createElement("div");
    maxSection.style.cssText =
      "display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--b3-border-color);padding-top:14px;";
    const maxLabel = document.createElement("div");
    maxLabel.style.cssText =
      "font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.05em;";
    maxLabel.textContent = this.t("maximize") + " / " + this.t("minimize");
    maxSection.appendChild(maxLabel);
    const maxDesc = document.createElement("div");
    maxDesc.style.cssText =
      "font-size:12px;color:var(--b3-theme-on-surface);opacity:.8;";
    maxDesc.textContent = "Alt+Shift+M";
    maxSection.appendChild(maxDesc);
    sb.appendChild(maxSection);
    sp.appendChild(sb);
    document.body.appendChild(sp);
    sp.querySelector("#og-sp-cls").addEventListener("click", () => {
      sp.remove();
      this._settingsPanel = null;
      this._updateSettingsIcon(false);
    });
    setTimeout(() => {
      const handler = (e) => {
        if (!sp.contains(e.target)) {
          sp.remove();
          this._settingsPanel = null;
          this._updateSettingsIcon(false);
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
    }, 100);
  }
  onunload() {
    if (this._panel && this._panel.style.display !== "none") {
      const panel = this._panel;
      if (this._isMinimized) this._restoreFromMinimized();
      const cs = getComputedStyle(panel);
      if (this._pinData?.pinned) {
        this._pinData = {
          pinned: true,
          top: panel.style.top || cs.top,
          left: panel.style.left || cs.left,
          right: panel.style.right || cs.right,
          width: panel.style.width || cs.width,
          height: panel.style.height || cs.height,
        };
      } else {
        this._lastPos = {
          top: panel.style.top || cs.top,
          left: panel.style.left || cs.left,
          right: panel.style.right || cs.right,
          width: panel.style.width || cs.width,
          height: panel.style.height || cs.height,
        };
      }
      this._savePrefs();
    }
    this._panel?.remove();
    this._settingsPanel?.remove();
    this._rightBarBtn?.remove();
    this._nativeGraphStyle?.remove();
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler);
    }
  }
};
