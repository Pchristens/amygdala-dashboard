// Road network for walking: nodes at path ends, polyline edges, Dijkstra routing, point snapping.
import { dist } from './svg-util.js';

export function sampleQuad(a, c, b, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return pts;
}

export function buildGraph(edges) {
  // edges: [{ points: [{x,y}...] }]; endpoints become nodes (merged within 6 units)
  const nodes = [];
  const key = (p) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) < 6) return i;
    nodes.push({ x: p.x, y: p.y, adj: [] });
    return nodes.length - 1;
  };
  const E = [];
  for (const e of edges) {
    const pts = e.points;
    if (!pts || pts.length < 2) continue;
    const a = key(pts[0]), b = key(pts[pts.length - 1]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
    const idx = E.length;
    E.push({ a, b, pts, len });
    nodes[a].adj.push({ to: b, e: idx, rev: false });
    nodes[b].adj.push({ to: a, e: idx, rev: true });
  }
  return { nodes, edges: E };
}

// nearest point on the network to p: returns { edge, i (segment index), point, d }
function snap(graph, p) {
  let best = null;
  graph.edges.forEach((e, ei) => {
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1], b = e.pts[i];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      // A snap connector may not climb a retaining wall or bypass a switchback.
      if (graph.height) {
        const n=Math.max(2,Math.ceil(dist(p,q)/3)); let prev=graph.height(p.x,p.y), safe=true;
        for(let k=1;k<=n;k++) { const h=graph.height(p.x+(q.x-p.x)*k/n,p.y+(q.y-p.y)*k/n); if(Math.abs(h-prev)>4||h<0) {safe=false;break;} prev=h; }
        if(!safe) continue;
      }
      const d = dist(p, q);
      if (!best || d < best.d) best = { edge: ei, i, t, point: q, d };
    }
  });
  return best;
}

function dijkstra(graph, src, dst) {
  const n = graph.nodes.length;
  const D = new Array(n).fill(Infinity), P = new Array(n).fill(-1), PE = new Array(n).fill(null);
  const done = new Array(n).fill(false);
  D[src] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || D[i] < D[u])) u = i;
    if (u < 0 || D[u] === Infinity) break;
    done[u] = true;
    if (u === dst) break;
    for (const { to, e, rev } of graph.nodes[u].adj) {
      const nd = D[u] + graph.edges[e].len;
      if (nd < D[to]) { D[to] = nd; P[to] = u; PE[to] = { e, rev }; }
    }
  }
  if (D[dst] === Infinity) return null;
  const path = [];
  let v = dst;
  while (v !== src) { path.unshift(PE[v]); v = P[v]; }
  return path; // list of {e, rev}
}

// Route from world point `from` to world point `to` along roads. Returns a polyline (incl. from and to).
export function route(graph, from, to) {
  if (!graph || !graph.edges.length) return [from, to];
  const direct = dist(from, to);
  const sa = snap(graph, from), sb = snap(graph, to);
  if (!sa || !sb) return graph.height ? [from] : [from, to];
  if (!graph.height && (direct < 60 || (sa.d > 90 && sb.d > 90))) return [from, to];
  // walk from `from` to its snap point, then along edges node to node, then to `to`
  const poly = [from, sa.point];
  if (sa.edge === sb.edge) {
    const e = graph.edges[sa.edge];
    const lo = Math.min(sa.i, sb.i), hi = Math.max(sa.i, sb.i);
    const mid = e.pts.slice(lo, hi);
    if (sa.i < sb.i) poly.push(...mid); else if(sa.i > sb.i) poly.push(...mid.reverse());
    poly.push(sb.point, to);
    return dedupe(poly);
  }
  // choose the better of the two endpoints of each snapped edge
  const ea = graph.edges[sa.edge], eb = graph.edges[sb.edge];
  const candA = [{ node: ea.a, lead: ea.pts.slice(0, sa.i).reverse() }, { node: ea.b, lead: ea.pts.slice(sa.i) }];
  const candB = [{ node: eb.a, tail: eb.pts.slice(0, sb.i) }, { node: eb.b, tail: eb.pts.slice(sb.i).reverse() }];
  let best = null;
  for (const A of candA) for (const B of candB) {
    const p = dijkstra(graph, A.node, B.node);
    if (!p) continue;
    let len = polyLen([sa.point, ...A.lead]) + polyLen([...B.tail, sb.point]);
    for (const { e } of p) len += graph.edges[e].len;
    if (!best || len < best.len) best = { len, A, B, p };
  }
  if (!best) return graph.height ? [from] : [from,to];
  if (!graph.height && best.len > direct * 2.6) return [from,to];
  poly.push(...best.A.lead);
  for (const { e, rev } of best.p) { const pts = graph.edges[e].pts; poly.push(...(rev ? [...pts].reverse() : pts)); }
  poly.push(...best.B.tail, sb.point, to);
  return dedupe(poly);
}
function polyLen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 0.5) out.push({ x: p.x, y: p.y });
  return out;
}
export { polyLen };
