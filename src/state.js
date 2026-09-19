// This function is serialized into the page by Playwright. Keep it self-contained.
export function readClientState() {
  const w = globalThis;
  const finite = (value) => Number.isFinite(value) ? value : null;
  const position = (o) => ({ x: finite(o.xx), y: finite(o.yy) });
  const renderPosition = (o) => ({ x: finite(o.xx + (o.fx || 0)), y: finite(o.yy + (o.fy || 0)) });
  const supported = Array.isArray(w.slithers) && Array.isArray(w.foods) && Array.isArray(w.preys);
  if (!supported) throw new Error('Unsupported Slither.io client: expected slithers, foods, and preys arrays.');

  const snake = (s) => ({
    id: s.id,
    name: s.nk ?? '',
    isSelf: s === w.slither,
    alive: !s.dead && !(s === w.slither && w.dead_mtm >= 0),
    head: position(s),
    renderHead: renderPosition(s),
    heading: finite(s.ang),
    targetHeading: finite(s.wang),
    speed: finite(s.sp),
    // Nominal radians/second from the client's server-configured turn equation.
    turnRate: finite(w.mamu * 125 * s.scang * s.spang),
    normalSpeed: finite(s.ssp),
    boostSpeed: finite(s.msp),
    boostRequested: s === w.slither ? Boolean(s.wmd) : null,
    scale: finite(s.sc),
    visualRadius: finite(14.5 * s.sc),
    segmentCount: finite(s.sct),
    growth: finite(s.fam),
    score: Number.isFinite(w.fpsls?.[s.sct]) && w.fmlts?.[s.sct] > 0
      ? Math.floor((w.fpsls[s.sct] + s.fam / w.fmlts[s.sct] - 1) * 15 - 5) : null,
    color: s.cs ?? null,
    skin: finite(s.rcv ?? s.cv),
    kills: finite(s.kill_count),
    // The client stores points from tail to neck. Include points fading out too.
    body: (s.pts ?? []).map(p => ({ ...position(p), renderPosition: renderPosition(p), dying: Boolean(p.dying) })),
  });
  const snakes = w.slithers.map(snake);
  const self = snakes.find(s => s.isSelf) ?? (w.slither ? snake(w.slither) : null);
  const food = w.foods.slice(0, w.foods_c).filter(Boolean).map(f => ({
    id: f.id, position: position(f), size: finite(f.sz), colorIndex: finite(f.cv),
    sector: { x: finite(f.sx), y: finite(f.sy) },
    eaten: Boolean(f.eaten), eatenBy: f.eaten_by?.id ?? null,
  }));
  const prey = w.preys.filter(Boolean).map(p => ({
    id: p.id, position: position(p), renderPosition: renderPosition(p),
    size: finite(p.sz), heading: finite(p.ang), targetHeading: finite(p.wang),
    speed: finite(p.sp), color: p.cs ?? null,
    eaten: Boolean(p.eaten), eatenBy: p.eaten_by?.id ?? null,
  }));

  let minimap = null;
  if (w.mmgad && w.mmsz > 0 && w.mmsz <= 512) {
    // Read the latest map canvas: it also supports protocol variants that do not
    // update mmdata. No screen recognition: these pixels are server map cells.
    const canvas = w.protocol_version >= 9 ? w.asmc2 : w.asmc;
    if (canvas) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, w.mmsz, w.mmsz).data;
      const cells = Array.from({ length: w.mmsz * w.mmsz }, (_, i) => pixels[i * 4 + 3] > 0 ? 1 : 0);
      minimap = { width: w.mmsz, height: w.mmsz, cells, encoding: 'row-major-occupancy', identifiesEntities: false };
    }
  }
  const status = w.dead_mtm >= 0 && w.ws?.readyState >= 2 && !w.connected ? 'disconnected'
    : w.dead_mtm >= 0 || w.slither?.dead ? 'dead'
    : w.playing && w.slither && w.connected && w.ws?.readyState === 1 ? 'playing'
      : w.connecting || w.want_play ? 'connecting' : 'menu';
  const center = finite(w.grd);
  const radius = finite(w.real_flux_grd ?? w.flux_grd);
  const serverSectors = (w.sectors ?? []).map(s => ({ x: s.xx, y: s.yy }));
  const foodSectors = [...new Map(food.filter(f => f.sector.x !== null && f.sector.y !== null)
    .map(f => [`${f.sector.x},${f.sector.y}`, f.sector])).values()];
  const lines = element => [...(element?.children ?? [])].filter(e => e.tagName === 'SPAN').map(e => e.textContent);
  const names = lines(w.lbn), scores = lines(w.lbs), ranks = lines(w.lbp);
  const canvasRect = w.mc?.getBoundingClientRect();

  return {
    schemaVersion: 1,
    capturedAt: Date.now(),
    status,
    client: {
      protocolVersion: finite(w.protocol_version),
      scriptUrl: [...document.scripts].map(s => s.src).find(s => /\/game[^/]*\.js/.test(s)) ?? null,
      connected: Boolean(w.connected), socketReadyState: w.ws?.readyState ?? null,
    },
    coverage: {
      mode: 'client-loaded', fullWorld: false,
      explanation: 'All entities currently sent to this client, including offscreen entities. Distant entities are unknown; the global minimap is anonymous occupancy only.',
      serverSectors, foodSectors,
      sectorsDescribeCompleteVisibility: false,
    },
    arena: {
      center: { x: center, y: center }, radius,
      renderedRadius: finite(w.flux_grd), sectorSize: finite(w.sector_size),
      sectorsAlongEdge: finite(w.sector_count_along_edge),
      bounded: center !== 2147483647 && radius !== null,
    },
    camera: {
      position: { x: finite(w.view_xx), y: finite(w.view_yy) },
      scale: finite(w.gsc), viewport: { width: w.innerWidth, height: w.innerHeight },
      viewportScale: canvasRect && w.mc.width ? finite(w.gsc * canvasRect.width / w.mc.width) : null,
      followsSelf: Boolean(w.follow_view),
    },
    self, snakes, food, prey, minimap,
    leaderboard: names.map((name, i) => ({ name, score: Number(scores[i]), rank: Number(ranks[i]?.replace('#', '')) })),
    stats: {
      rank: w.rank > 0 ? finite(w.rank) : null,
      totalPlayers: w.slither_count > 0 ? finite(w.slither_count) : null,
      bestRank: w.best_rank > 0 && w.best_rank < 999999999 ? finite(w.best_rank) : null,
    },
  };
}

export function validateState(state) {
  if (state.schemaVersion !== 1) throw new Error('Unsupported observation schema.');
  if (state.status === 'playing') {
    if (!state.self || !Number.isFinite(state.self.head.x) || !Number.isFinite(state.self.head.y)) {
      throw new Error('Client reports playing without a valid player position.');
    }
    if (!state.snakes.some(s => s.id === state.self.id)) throw new Error('Player is missing from the snake list.');
  }
  return state;
}
