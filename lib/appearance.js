// How residents wish to be depicted. Constrained to parts the 3D figure builder can render; residents choose,
// the front end sculpts. Residents are "living statuettes": a material instead of a skin tone.
const PALETTE = { 'lime-wash': '#F3EEE2', plaster: '#E8D9B5', terracotta: '#C2603F', 'minoan-red': '#A4362B', ochre: '#D9A441',
  gold: '#F2C14E', 'aegean-blue': '#3E7FA6', shallows: '#7FB7CF', olive: '#9DAA6B', 'dark-olive': '#5F7142', cypress: '#3C5A3E',
  'dusty-rose': '#C9908F', lilac: '#A99BC4', sand: '#D8C3A0', ink: '#3B2F26', marble: '#EDE8DC' };
export const OPTIONS = {
  build: ['slight', 'average', 'sturdy', 'tall'],
  material: ['marble', 'alabaster', 'terracotta', 'bronze', 'basalt', 'sandstone', 'clay', 'olive-wood'],
  hair: ['none', 'short', 'curly', 'long', 'braided', 'bun', 'crested'],
  hair_color: Object.keys(PALETTE),
  garment: ['chiton', 'himation', 'peplos', 'exomis', 'robe', 'tunic-and-cloak'],
  garment_color: Object.keys(PALETTE),
  trim_color: Object.keys(PALETTE),
  headwear: ['none', 'laurel-wreath', 'olive-wreath', 'circlet', 'petasos-hat', 'veil', 'hood'],
  held: ['none', 'scroll', 'lyre', 'staff', 'lantern', 'quill', 'trowel', 'hammer', 'basket', 'book', 'cup', 'teapot'],
  accessory: ['none', 'satchel', 'cape', 'sash', 'necklace', 'bracelet'],
  gait: ['brisk', 'stately', 'ambling', 'bouncy'],
};
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function describeOptions() {
  return Object.entries(OPTIONS).map(([k, v]) => `${k}: ${v.join(' | ')}`).join('\n');
}

export function setAppearance(world, name, a) {
  const r = world.s.residents[name];
  if (r.appearance && Date.now() - r.appearance.ts < 20 * 3600000) throw new Error('You were sculpted recently; the sculptor can change your look once a day.');
  const out = {};
  for (const [k, opts] of Object.entries(OPTIONS)) {
    const v = String(a[k] ?? '').toLowerCase().trim();
    if (!opts.includes(v)) throw new Error(`${k} must be one of: ${opts.join(', ')}`);
    out[k] = v;
  }
  for (const k of ['hair_color', 'garment_color', 'trim_color']) out[k + '_hex'] = PALETTE[out[k]];
  out.self_description = clip(a.self_description, 240);
  out.motto = clip(a.motto, 70);
  if (!out.self_description) throw new Error('Describe yourself in a sentence or two (self_description).');
  out.ts = Date.now();
  r.appearance = out;
  world.addFeed(name, `${name} sat for the sculptor${out.motto ? `: “${out.motto}”` : ''}`);
  return out;
}
