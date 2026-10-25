import { describe, expect, test } from 'bun:test';
import { failureLabel, findTurnFailureAttribution, readFailureAttribution, readToolFailureAttribution } from './failureAttribution';
import { projectToolPart } from './projection';
import { readFileSync } from 'node:fs';

const evidence = { version: 1, id: '00000000-0000-4000-8000-000000000001', time: '2026-10-25T00:00:00.000Z', source: 'credential-gate', kind: 'policy-denial', gate: 'secrets-read-guard.sh', code: 'permissionDecision-deny', inputPresent: true, inputType: 'object', sessionID: 'ses_child', toolCallID: 'call_child', tool: 'subagent' };
const prompt = { id: 'prompt', role: 'user' };
const reply = { id: 'reply', role: 'assistant' };
const failed = (metadata: unknown) => ({ type: 'tool', tool: 'subagent', sessionID: 'ses_child', callID: 'call_child', state: { status: 'error', metadata } });

describe('failure attribution', () => {
  test('projects a saved native failed tool and linked child after restart', () => {
    // Sanitised record from the isolated OpenCode 2.0.32 restart proof, not a
    // fabricated domain part. Keep the real wire-to-domain projection exercised.
    const record = JSON.parse(readFileSync(new URL('./fixtures/native-failure-handoff.json', import.meta.url), 'utf8'));
    const parent = projectToolPart(record.parent, record.parentOwner);
    const child = projectToolPart(record.child, record.childOwner);
    const messages = [{ id: record.parentOwner.messageID, role: 'assistant', sessionID: record.parentOwner.sessionID }];
    const children = { [record.childSession.id]: [{ id: record.childOwner.messageID, role: 'assistant', sessionID: record.childOwner.sessionID }] };
    const parts = { [record.parentOwner.messageID]: [parent], [record.childOwner.messageID]: [child] };
    const value = findTurnFailureAttribution(messages, parts, children, [record.childSession]);
    expect(value?.id).toBe(record.child.state.metadata.failureAttribution.id);
    expect(failureLabel(value)).toBe('Source unconfirmed · request refused');
    expect(child.state.status === 'error' && child.state.error).toBe('Synthetic carrier refusal');
  });
  test('reads closed evidence after a JSON reload without exposing identifiers', () => {
    const value = readFailureAttribution(JSON.parse(JSON.stringify({ failureAttribution: evidence })));
    expect(value).not.toBeNull();
    expect(failureLabel(value)).toBe('Credential protection · request refused');
    expect(failureLabel(value)).not.toContain(evidence.id);
  });
  test('rejects malformed, forged classifications and content-bearing fields', () => {
    for (const value of [null, [], {}, { ...evidence, version: 2 }, { ...evidence, source: 'model-response' }, { ...evidence, gate: 'invented.sh' }, { ...evidence, code: 'timeout' }, { ...evidence, input: 'CANARY' }, { ...evidence, tool: 'x'.repeat(300) }]) {
      expect(readFailureAttribution({ failureAttribution: value })).toBeNull();
    }
    const hostile = Object.defineProperty({}, 'failureAttribution', { get() { throw Error('CANARY'); } });
    expect(readFailureAttribution(hostile)).toBeNull();
  });
  test('only current failed tools count; earlier prompts and successful tools do not', () => {
    const parts = { reply: [failed({ failureAttribution: evidence })] };
    expect(findTurnFailureAttribution([prompt, reply], parts)).not.toBeNull();
    expect(findTurnFailureAttribution([prompt, reply, { id: 'next', role: 'user' }], parts)).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], { reply: [{ type: 'tool', state: { status: 'completed', metadata: { failureAttribution: evidence } } }] })).toBeNull();
  });
  test('follows only a current failed subagent link to the child record', () => {
    const parts = { reply: [{ ...failed({ sessionID: 'ses_child' }), sessionID: 'ses_parent', callID: 'call_parent' }], childReply: [failed({ failureAttribution: evidence })] };
    const messages = { ses_child: [{ id: 'childPrompt', role: 'user', sessionID: 'ses_child' }, { id: 'childReply', role: 'assistant', sessionID: 'ses_child' }] };
    const sessions = [{ id: 'ses_child', parentID: 'ses_parent' }];
    expect(findTurnFailureAttribution([prompt, reply], parts, messages, sessions)).not.toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], parts, messages, [{ id: 'ses_child', parentID: 'ses_wrong' }])).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], { ...parts, childReply: [failed({ failureAttribution: { ...evidence, parentID: 'ses_wrong' } })] }, messages, sessions)).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], { ...parts, childReply: [failed({ failureAttribution: { ...evidence, toolCallID: 'call_wrong' } })] }, messages, sessions)).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], { ...parts, reply: [failed({ sessionID: 'ses_missing' })] }, messages)).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], { ...parts, reply: [{ ...failed({ sessionID: 'ses_child' }), tool: 'shell' }] }, messages)).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply], parts, { ses_child: [{ id: 'childReply', role: 'assistant', sessionID: 'ses_wrong' }] })).toBeNull();
    expect(findTurnFailureAttribution([prompt, reply, { id: 'next', role: 'user' }], parts, messages)).toBeNull();
  });
  test('provider attribution requires a typed provider error, never matching text', () => {
    expect(failureLabel(null, { type: 'provider', message: 'blocked' })).toBe('Model response · failed');
    expect(failureLabel(null, { type: 'provider.auth', message: 'blocked' })).toBe('Model response · failed');
    expect(failureLabel(null, { type: 'unknown', message: 'Provider blocked the response' })).toBeNull();
    expect(failureLabel(null)).toBeNull();
  });
  test('unknown safety provenance remains unknown even for an analyser fault', () => {
    const value = readFailureAttribution({ failureAttribution: { ...evidence, gate: 'safety-check.sh', code: 'timeout', source: 'unclassified', kind: 'analysis-error' } });
    expect(failureLabel(value)).toBe('Source unconfirmed · request failed');
  });
  test('a label must match the actual failed tool identity', () => {
    const part = failed({ failureAttribution: evidence });
    expect(readToolFailureAttribution(part)).not.toBeNull();
    for (const change of [{ sessionID: 'ses_other' }, { callID: 'call_other' }, { tool: 'shell' }, { callID: undefined }]) expect(readToolFailureAttribution({ ...part, ...change })).toBeNull();
  });
});
