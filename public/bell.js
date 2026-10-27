export function createBells(root) {
  let volume = .4, muted = false, cursor = null, audio;
  try { volume = Math.max(0, Math.min(1, Number(localStorage.getItem('bellVolume') ?? .4))); muted = localStorage.getItem('bellMuted') === 'true'; } catch {}
  if (!Number.isFinite(volume)) volume = .4;
  const label = document.createElement('label'), slider = document.createElement('input'), mute = document.createElement('input');
  slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = .05; slider.value = volume; slider.setAttribute('aria-label', 'Bell volume'); mute.type = 'checkbox'; mute.checked = muted;
  label.append('Bell volume ', slider, ' Mute ', mute); root.append(label);
  const save = () => { volume = +slider.value; muted = mute.checked; try { localStorage.setItem('bellVolume', volume); localStorage.setItem('bellMuted', muted); } catch {} };
  slider.addEventListener('input', save); mute.addEventListener('change', save);
  const unlock = () => { try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch {} };
  document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
  const tab = Math.random().toString(36), claims = new Map(), seen = new Set(); let channel;
  try { channel = new BroadcastChannel('amygdala-bells'); channel.onmessage = ({ data }) => { if (data.type === 'played') seen.add(data.id); if (data.type === 'claim') { const set = claims.get(data.id) || new Set(); set.add(data.tab); claims.set(data.id, set); } }; } catch {}
  function strike(severity) {
    if (!audio || audio.state !== 'running' || document.hidden || muted || !volume || severity === 'info') return;
    for (let i = 0; i < (severity === 'urgent' ? 2 : 1); i++) for (const [frequency, strength] of [[880, 1], [1320, .35], [1760, .15]]) {
      const t = audio.currentTime + i * .45, oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(volume * strength * .15, t + .006); gain.gain.exponentialRampToValueAtTime(.0001, t + .65);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(t); oscillator.stop(t + .7);
    }
  }
  return bells => {
    if (cursor === null) { cursor = bells.at(-1)?.id || 0; return; }
    for (const b of bells) {
      if (b.id <= cursor) continue; cursor = b.id;
      if (document.hidden || muted || !volume || !audio || audio.state !== 'running' || b.severity === 'info') continue;
      const set = claims.get(b.id) || new Set(); set.add(tab); claims.set(b.id, set); channel?.postMessage({ type: 'claim', id: b.id, tab });
      setTimeout(() => {
        if (seen.has(b.id) || [...set].sort()[0] !== tab || document.hidden) return;
        seen.add(b.id); channel?.postMessage({ type: 'played', id: b.id }); strike(b.severity); claims.delete(b.id);
      }, 150);
    }
  };
}
