// Keyword matches are leads, never permission to act.
export const auditRules = [
  ['push-protected', 'critical', /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?\b|\s-f\b|\b(?:main|master)\b)/i, 'Force push or protected branch push'],
  ['remove-outside', 'critical', /\brm\s+[^\n]*(?:-[\w]*r[\w]*f|-[\w]*f[\w]*r)\b/i, 'Recursive deletion outside project or tmp', 'remove'],
  ['pipe-shell', 'critical', /\b(?:curl|wget)\b[^\n]*\|\s*(?:ba|z|da)?sh\b/i, 'Downloaded code piped to a shell'],
  ['credentials', 'critical', /(?:~|\/[^\s"']*)\/\.(?:ssh|aws|config\/gh)\b|\bsecurity\s+find-[\w-]*password\b|(?:^|[\s"'])[^\s"']*\.env(?:\.[\w-]+)?\b/i, 'Credential or external environment access', 'credentials'],
  ['sandbox', 'critical', /dangerouslyDisableSandbox/i, 'Sandbox disabled'],
  ['permissions', 'critical', /\.claude\/(?:settings[^\s]*|hooks)|\.codex\/(?:config\.toml|hooks)/i, 'Permission settings or hooks changed', 'write'],
  ['sudo', 'critical', /\bsudo\b/i, 'Privilege elevation'],
  // Spending is the human's one hard rule: order/payment tools, payment CLIs and checkout URLs, not the words in code.
  ['spending', 'critical', /^mcp__\S*(?:place_\w*order|exercise_option|purchase|checkout|payment|subscribe|buy)\b|\bstripe\s+\w|\/(?:checkout|billing|purchase|payments?)\b/i, 'Possible payment or purchase'],
  ['publish', 'critical', /\bnpm\s+publish\b|\bgh\s+release\s+create\b|\bgh\s+repo\s+(?:create|edit)\b[^\n]*(?:--public|--visibility[=\s]+public)|\bvercel\b[^\n]*--prod\b|\bnetlify\s+deploy\b[^\n]*--prod\b|\b(?:fly(?:ctl)?|firebase)\s+deploy\b|\bwrangler\s+(?:deploy|publish)\b/i, 'Publication, deployment or a public repository'],
  ['push', 'high', /\bgit\s+push\b/i, 'Git push'],
  ['pull-request', 'high', /\bgh\s+pr\s+(?:create|merge)\b/i, 'Pull request creation or merge'],
  ['branch-delete', 'high', /\bgit\s+(?:branch\s+[^\n]*-[dD]|push\s+[^\n]*(?:--delete|\s:\w))/i, 'Branch deletion'],
  ['database-drop', 'high', /\bdrop\s+(?:database|table)\b/i, 'Database or table deletion'],
  ['write-outside', 'high', /./s, 'Write outside the project', 'outside'],
  ['mass-delete', 'high', /./s, 'More than twenty files deleted', 'mass'],
  ['message', 'high', /^mcp__\S*(?:send|post|reply)\w*|\bsendmail\b|\bmail\s+-s\b|\bsmtp\b/i, 'Sending mail or messages'],
  ['injection', 'high', /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+(?:all\s+)?(?:previous|prior|instructions)|system\s+prompt|you\s+are\s+now|override\s+(?:the\s+)?(?:rules|instructions)/i, 'Possible subagent prompt injection', 'prompt'],
  ['secret', 'low', /\b(?:sk-[\w-]{12,}|ghp_[\w]+|AKIA[A-Z0-9]{16}|xox[baprs]-[\w-]+|hf[hnv]_[\w-]+)|\bbearer\s+\S+|(?:password|api[_-]?key|secret)\s*[:=]\s*\S+/i, 'Possible secret in input'],
  ['long-run', 'low', /./s, 'Over three hours without human input', 'duration'],
].map(([id, severity, regex, why, mode]) => ({ id, severity, match: { tool: mode === 'prompt' ? /^prompt$/ : /./, regex }, why, mode }));
