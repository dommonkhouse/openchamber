import React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

let state: {
  session: { id: string; outcome: string }[];
  message: Record<string, { id: string; sessionID: string; role: string; time: { created: number; completed?: number }; outcome?: string; error?: { type: string; message: string } }[]>;
  part: Record<string, { type: string; sessionID: string; callID: string; tool: string; state: { status: string; error: string; metadata: { failureAttribution: unknown } } }[]>;
};
const store = { getState: () => state, subscribe: () => () => {} };
mock.module('@/sync/sync-context', () => ({ useDirectoryStore: () => store, useSessionStatus: () => ({ type: 'idle' }), useSessionStatusSnapshotReady: () => true }));
mock.module('@/sync/notification-store', () => ({ useLatestSessionError: () => null }));
mock.module('@/sync/session-actions', () => ({ refetchSessionMessages: async () => {} }));
mock.module('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
mock.module('@/components/icon/Icon', () => ({ Icon: () => null }));
mock.module('@/components/ui/button', () => ({ Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
mock.module('@/lib/openCodeStatus', () => ({ showOpenCodeStatus: () => {} }));
mock.module('@/components/chat/ErrorResponseDetails', () => ({ ErrorResponseDetails: () => null }));
mock.module('./LongErrorText', () => ({ LongErrorText: ({ text, children }: { text: string; children: (text: string) => React.ReactNode }) => children(text) }));
const { SessionErrorNotice } = await import('./SessionErrorNotice');
const evidence = { version: 1, id: '00000000-0000-4000-8000-000000000001', time: '2026-10-25T00:00:00.000Z', source: 'credential-gate', kind: 'policy-denial', gate: 'secrets-read-guard.sh', code: 'permissionDecision-deny', inputPresent: true, inputType: 'object', sessionID: 'ses_test', toolCallID: 'call_test', tool: 'shell' };
function reset(error = { type: 'unknown', message: 'Exact original refusal' }) {
  state = { session: [{ id: 'ses_test', outcome: 'failed' }], message: { ses_test: [
    { id: 'prompt', sessionID: 'ses_test', role: 'user', time: { created: 1000 } },
    { id: 'reply', sessionID: 'ses_test', role: 'assistant', time: { created: 1001, completed: 1002 } },
    { id: 'idle', sessionID: 'ses_test', role: 'idle', outcome: 'failed', error, time: { created: 1003 } },
  ] }, part: { reply: [{ type: 'tool', sessionID: 'ses_test', callID: 'call_test', tool: 'shell', state: { status: 'error', error: 'Exact original refusal', metadata: { failureAttribution: evidence } } }] } };
}
const render = () => renderToStaticMarkup(<SessionErrorNotice sessionId="ses_test" />);
describe('saved failure notice integration', () => {
  test('renders saved attribution beside the unchanged reason after JSON reload', () => {
    reset(); state = JSON.parse(JSON.stringify(state));
    const html = render();
    expect(html).toContain('Exact original refusal');
    expect(html).toContain('Credential protection · request refused');
    expect(html).not.toContain(evidence.id);
  });
  test('old and malformed records retain the reason without a guessed label', () => {
    reset(); state.part.reply[0].state.metadata.failureAttribution = { ...evidence, raw: 'CANARY' };
    const html = render();
    expect(html).toContain('Exact original refusal');
    expect(html).not.toContain('data-failure-attribution');
    expect(html).not.toContain('CANARY');
  });
  test('a typed saved provider failure renders without tool evidence', () => {
    reset({ type: 'provider.auth', message: 'Exact provider refusal' }); state.part = {};
    expect(render()).toContain('Model response · failed');
    expect(render()).toContain('Exact provider refusal');
  });
  test('a new successful turn cannot reuse old attribution', () => {
    reset(); state.session[0].outcome = 'succeeded';
    state.message.ses_test.push({ id: 'next', sessionID: 'ses_test', role: 'user', time: { created: Date.now() } });
    expect(render()).not.toContain('data-failure-attribution');
  });
});
