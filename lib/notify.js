import { execFile } from './bin.js';
export const bellText = b => b.isle ? '🔔 A bell rang on the Far Isle' : b.text || `🔔 ${b.severity} — ${b.summary} from ${b.by}`;
export function publicBell(b) { return b.isle ? { id: b.id, ts: b.ts, severity: b.severity, isle: true, text: bellText(b) } : { id: b.id, ts: b.ts, severity: b.severity, by: b.by, summary: b.summary, isle: false, text: bellText(b) }; }
export function bellBatch(bells, cursor = 0, now = Date.now(), offline = false) {
  const pending = bells.filter(b => b.id > cursor), ready = [];
  if (!pending.length) return ready;
  if (offline) return [{ id: pending.at(-1).id, ts: now, severity: 'attention', text: `${pending.at(-1).id - cursor} bells rang while you were away` }];
  for (let i = 0; i < pending.length;) {
    const start = pending[i].ts, group = [];
    while (i < pending.length && pending[i].ts - start < 60000) group.push(pending[i++]);
    if (now - start < 60000) break;
    if (group.length > 3) ready.push({ id: group.at(-1).id, ts: group.at(-1).ts, severity: group.some(b => b.severity === 'urgent') ? 'urgent' : 'attention', text: `${group.length} bells rang` });
    else ready.push(...group.map(publicBell));
  }
  return ready;
}
const apple = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function notify(b, { platform = process.platform, run = execFile } = {}) {
  const text = bellText(b), sound = b.severity === 'urgent' ? 'Sosumi' : 'Glass';
  let file, args;
  if (platform === 'darwin') { file = 'osascript'; args = ['-e', `display notification ${apple(text)} with title "Amygdala"${b.severity === 'info' ? '' : ` sound name "${sound}"`}`]; }
  else if (platform === 'win32') {
    const toast = `<toast><visual><binding template="ToastGeneric"><text>Amygdala</text><text>${xml(text)}</text></binding></visual><audio ${b.severity === 'info' ? 'silent="true"' : `src="ms-winsoundevent:Notification.${b.severity === 'urgent' ? 'Reminder' : 'Default'}"`}/></toast>`;
    const encoded = Buffer.from(toast).toString('base64');
    file = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-Command', `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null; $x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); $app = 'HKCU:\\Software\\Classes\\AppUserModelId\\Amygdala'; New-Item -Path $app -Force > $null; New-ItemProperty -Path $app -Name DisplayName -Value 'Amygdala' -PropertyType String -Force > $null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Amygdala').Show([Windows.UI.Notifications.ToastNotification]::new($x))`];
  } else if (platform === 'linux') { file = 'notify-send'; args = ['-a', 'Amygdala', '-u', b.severity === 'urgent' ? 'critical' : 'normal', ...(b.severity === 'info' ? ['-h', 'boolean:suppress-sound:true'] : ['-h', 'string:sound-name:bell']), '--', 'Amygdala', text]; }
  else return Promise.resolve(false);
  return new Promise(resolve => { try { run(file, args, { timeout: 10000, windowsHide: true, shell: false }, error => resolve(!error)); } catch { resolve(false); } });
}
