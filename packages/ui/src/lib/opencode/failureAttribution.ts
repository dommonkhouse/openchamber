// Consumer contract for claude-config/opencode-plugins/failure-attribution.ts.
// Never infer provenance from the original human-readable failure text.
const gates = new Set(['block-glob-rm.sh', 'safety-check.sh', 'git-commit-gate.sh', 'wp-password-guard.sh', 'pre-live-dash-gate.sh', 'wp-cli-notice-gate.sh', 'wp-bash-publish-gate.sh', 'skill-run-gate.sh', 'key-action-gate.sh', 'wp-live-edit-guard.sh', 'gdrive-trash-gate.sh', 'worktree-boundary-gate.sh', 'secrets-read-guard.sh', 'send-keyword-gate.py']);
const faults = new Set(['spawn-error', 'timeout', 'nonzero-exit', 'unparseable-stdout']);
const explicit = new Set(['permissionDecision-deny', 'decision-block']);
const keys = new Set(['version', 'id', 'time', 'source', 'kind', 'code', 'gate', 'inputPresent', 'inputType', 'sessionID', 'parentID', 'toolCallID', 'tool']);
type Evidence = { version: 1; id: string; time: string; source: 'credential-gate' | 'unclassified'; kind: 'policy-denial' | 'analysis-error' | 'unknown'; gate: string; code: string; inputPresent: boolean; inputType: string; sessionID?: string; parentID?: string; toolCallID?: string; tool?: string };
type HistoryMessage = { id: string; role: string; sessionID?: string };
type HistoryPart = { type: string; tool?: string; sessionID?: string; callID?: string; state?: { status: string; metadata?: unknown } };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function readFailureAttribution(metadata: unknown): Evidence | null {
  try {
    if (!object(metadata) || !object(metadata.failureAttribution)) return null;
    const v = metadata.failureAttribution;
    if (Object.keys(v).some(k => !keys.has(k)) || v.version !== 1 || typeof v.gate !== 'string' || !gates.has(v.gate) || typeof v.code !== 'string' || (!faults.has(v.code) && !explicit.has(v.code) && v.code !== 'exit-2')) return null;
    if (typeof v.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id)) return null;
    if (typeof v.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.time) || !Number.isFinite(Date.parse(v.time))) return null;
    const source = explicit.has(v.code) && ['secrets-read-guard.sh', 'wp-password-guard.sh'].includes(v.gate) ? 'credential-gate' : 'unclassified';
    const kind = faults.has(v.code) ? 'analysis-error' : explicit.has(v.code) ? 'policy-denial' : 'unknown';
    if (v.source !== source || v.kind !== kind || typeof v.inputPresent !== 'boolean' || typeof v.inputType !== 'string' || !['undefined', 'null', 'array', 'object', 'string', 'number', 'boolean', 'bigint', 'symbol', 'function'].includes(v.inputType) || v.inputPresent !== (v.inputType !== 'undefined')) return null;
    for (const key of ['sessionID', 'parentID', 'toolCallID', 'tool']) {
      const field = v[key];
      if (field === undefined) continue;
      if (typeof field !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(field) || ((key === 'sessionID' || key === 'parentID') && !field.startsWith('ses_'))) return null;
    }
    if (JSON.stringify(v).length > 2048) return null;
    return v as Evidence;
  } catch { return null; }
}

export function readToolFailureAttribution(part: HistoryPart): Evidence | null {
  if (part.type !== 'tool' || part.state?.status !== 'error') return null;
  const value = readFailureAttribution(part.state.metadata);
  if (!value || !part.sessionID || !part.callID || value.sessionID !== part.sessionID || value.toolCallID !== part.callID || value.tool !== part.tool) return null;
  return value;
}

/** Search only this prompt's failed tools; a later prompt invalidates old evidence. */
export function findTurnFailureAttribution(messages: readonly HistoryMessage[] | undefined, parts: Record<string, readonly HistoryPart[] | undefined>, childMessages: Record<string, readonly HistoryMessage[] | undefined> = {}, sessions: readonly { id: string; parentID?: string }[] = [], visited = new Set<string>(), expectedSession?: string): Evidence | null {
  try {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const message = messages![i];
      if (message.role === 'user') break;
      const entries = parts[message.id] ?? [];
      for (let j = entries.length - 1; j >= 0; j--) {
        const part = entries[j];
        if (part.type !== 'tool' || part.state?.status !== 'error') continue;
        if (expectedSession && (part.sessionID !== expectedSession || message.sessionID !== expectedSession)) continue;
        if (message.sessionID && part.sessionID !== message.sessionID) continue;
        const metadata = part.state.metadata;
        const direct = readToolFailureAttribution(part);
        if (direct) return direct;
        if (part.tool !== 'subagent' || !object(metadata) || typeof metadata.sessionID !== 'string' || !metadata.sessionID.startsWith('ses_') || visited.has(metadata.sessionID) || visited.size >= 8) continue;
        if (!part.sessionID || !part.callID || !sessions.some(s => s.id === metadata.sessionID && s.parentID === part.sessionID)) continue;
        visited.add(metadata.sessionID);
        const linked = findTurnFailureAttribution(childMessages[metadata.sessionID], parts, childMessages, sessions, visited, metadata.sessionID);
        if (linked && (!linked.parentID || linked.parentID === part.sessionID)) return linked;
      }
    }
  } catch { /* Broken or unavailable reporting must not affect the original error. */ }
  return null;
}

export function failureLabel(evidence: Evidence | null, error?: { type: string; message?: string } | null): string | null {
  if (evidence) return `${evidence.source === 'credential-gate' ? 'Credential protection' : 'Source unconfirmed'} · ${evidence.kind === 'policy-denial' ? 'request refused' : 'request failed'}`;
  return error && ['provider', 'provider.auth'].includes(error.type) ? 'Model response · failed' : null;
}
