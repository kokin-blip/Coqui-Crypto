import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, LockKeyhole, Send, Sparkles, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import type { WorkstationBar } from './chart-workstation-types.js';
import { useDialogFocus } from './use-dialog-focus.js';
import { applyAdvisorNavigation } from './advisor-navigation.js';

type Provider = 'gemini' | 'openai' | 'anthropic';
type Answer = ChannelResponse<'advisor.facts.generate'>;

export function AdvisorSheet({ client, productId, bars, onClose }: {
  readonly client: CoquiClient; readonly productId: string; readonly bars: readonly WorkstationBar[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const providers = useChannel(client, 'advisor.providers', {});
  const history = useChannel(client, 'advisor.chat.history', { conversationId: null });
  const removeHistory = useCommand(client, 'advisor.chat.history.delete', ['advisor.chat.history']);
  const exportHistory = useCommand(client, 'advisor.chat.history.export');
  const connectProvider = useCommand(client, 'advisor.provider.connect', ['advisor.providers']);
  const disconnectProvider = useCommand(client, 'advisor.provider.disconnect', ['advisor.providers']);
  const available = providers.kind === 'ready' ? providers.value.providers : [];
  const [provider, setProvider] = useState<Provider>('gemini');
  const [mode, setMode] = useState<'analysis' | 'scenario_ideas'>('analysis');
  const [question, setQuestion] = useState('');
  const [includeChart, setIncludeChart] = useState(true);
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [includePortfolio, setIncludePortfolio] = useState(false);
  const [encrypted, setEncrypted] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [preparedContextHash, setPreparedContextHash] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  const selected = available.find((item) => item.provider === provider);
  const contextBars = useMemo(() => bars.slice(-500).map((bar) => ({ timeMs: bar.startTimeMs,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    complete: bar.isComplete })), [bars]);
  const prepare = useCallback(async () => client.query('advisor.context.prepare', { productId,
    bars: contextBars, evidence: [], portfolio: [], scope: { chartData: includeChart,
      visibleEvidence: includeEvidence, sanitizedPortfolio: includePortfolio } }),
  [client, contextBars, includeChart, includeEvidence, includePortfolio, productId]);
  useEffect(() => {
    let active = true;
    setPreparedContextHash(null);
    void prepare().then((result) => {
      if (active && result.status === 'ok') setPreparedContextHash(result.value.contextHash);
    });
    return () => { active = false; };
  }, [prepare]);
  const answerIsStale = answer !== null && answer.contextHash !== preparedContextHash;
  const generateFacts = async (cloud: boolean): Promise<void> => {
    setBusy(true); setFailure(null);
    const context = await prepare();
    if (context.status !== 'ok') { setFailure('Context could not be prepared.'); setBusy(false); return; }
    const result = await client.query('advisor.facts.generate', { commandId: crypto.randomUUID(),
      contextHash: context.value.contextHash, provider: cloud ? provider : null });
    if (result.status === 'ok') setAnswer(result.value); else setFailure(result.issues[0]?.code ?? 'Advisor request failed.');
    setBusy(false);
  };
  const send = async (): Promise<void> => {
    if (question.trim().length === 0) return;
    setBusy(true); setFailure(null);
    const context = await prepare();
    if (context.status !== 'ok') { setFailure('Context could not be prepared.'); setBusy(false); return; }
    const result = await client.query('advisor.chat.send', { commandId: crypto.randomUUID(),
      contextHash: context.value.contextHash, provider, mode, message: question.trim(),
      conversationId, retention: encrypted ? 'encrypted' : 'session' });
    if (result.status === 'ok') { setAnswer(result.value.answer); setConversationId(result.value.conversationId); setQuestion(''); }
    else setFailure(result.issues[0]?.code ?? 'Advisor request failed.');
    setBusy(false);
  };
  const navigate=async(target:'activity'|'paper'|'research'|'risk'|'market'):Promise<void>=>{
    const result=await applyAdvisorNavigation(client,{target,decisionId:null,candidateId:null,
      productId:target==='market'?productId:null,eventId:null});
    if(result.status==='ok'&&target!=='market') onClose();
  };
  return createPortal(<div className="analyst-sheet-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="analyst-title" className="analyst-sheet" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="violet-kicker"><Sparkles size={13} /> Coqui analyst</span><h2 id="analyst-title">Key facts · {productId}</h2></div><button type="button" className="icon-button" aria-label="Close analyst" onClick={onClose}><X size={17} /></button></header>
      <p className="analyst-boundary"><Bot size={17} /> Explanations and non-binding scenarios only. This surface cannot create, approve, or alter an order.</p>
      <nav className="advisor-destinations" aria-label="Advisor destinations">
        <span>Go to evidence</span>
        <button type="button" onClick={()=>void navigate('activity')}>Activity</button>
        <button type="button" onClick={()=>void navigate('paper')}>Paper</button>
        <button type="button" onClick={()=>void navigate('research')}>Research</button>
        <button type="button" onClick={()=>void navigate('risk')}>Risk</button>
        <button type="button" onClick={()=>void navigate('market')}>This market</button>
      </nav>
      <fieldset className="advisor-context-options"><legend>Share for this request</legend><label><input type="checkbox" checked={includeChart} onChange={(event) => setIncludeChart(event.target.checked)} /> Chart data</label><label><input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} /> Visible Coqui evidence</label><label><input type="checkbox" checked={includePortfolio} onChange={(event) => setIncludePortfolio(event.target.checked)} /> Sanitized portfolio context</label></fieldset>
      <div className="advisor-provider-row"><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>{available.map((item) => <option key={item.provider} value={item.provider}>{item.provider} · {item.credentialState}</option>)}</select></label><label>Response<select value={mode} onChange={(event) => setMode(event.target.value as 'analysis' | 'scenario_ideas')}><option value="analysis">Analysis</option><option value="scenario_ideas">Scenario ideas</option></select></label></div>
      {selected?.credentialState !== 'connected' ? <div className="advisor-connect"><label><span>{provider} API key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Stored in the OS secret store" /></label><button type="button" disabled={apiKey.length < 20 || connectProvider.state.kind === 'pending'} onClick={() => { void connectProvider.run({ commandId: crypto.randomUUID(), provider, apiKey, confirmed: true }); setApiKey(''); }}>Connect</button></div> : <button type="button" className="advisor-disconnect" onClick={() => void disconnectProvider.run({ commandId: crypto.randomUUID(), provider, confirmed: true })}>Disconnect {provider}</button>}
      <div className="advisor-fact-actions"><button type="button" disabled={busy} onClick={() => void generateFacts(false)}>Generate local facts</button><button type="button" disabled={busy || selected?.credentialState !== 'connected'} onClick={() => void generateFacts(true)}>Enrich with {provider}</button></div>
      {answer !== null && <article className="advisor-answer" data-stale={answerIsStale || undefined}><header><strong>{answer.provider === 'local' ? 'Deterministic local facts' : `${answer.provider} · ${answer.model}`}</strong><span>{answerIsStale ? 'STALE' : answer.mode === 'scenario_ideas' ? 'SCENARIOS' : 'ANALYSIS'}</span></header>{answerIsStale && <p className="advisor-stale" role="status">Source context changed. Generate a new answer before relying on this analysis.</p>}<p>{answer.text}</p><footer>Context {answer.contextHash.slice(0, 10)}… · data {new Date(answer.dataTimestampMs).toISOString()}<br />Advisory only · No execution authority</footer></article>}
      {failure !== null && <p className="advisor-failure" role="alert">{failure}</p>}
      <label className="advisor-question"><span>Ask a question</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What stands out in this completed price history?" /></label>
      <div className="advisor-suggestions" aria-label="Evidence-scoped suggested questions">
        <button type="button" onClick={()=>setQuestion(`What completed-bar facts stand out for ${productId}?`)}>What stands out?</button>
        <button type="button" onClick={()=>setQuestion(`What data-quality limits apply to ${productId}?`)}>What are the data limits?</button>
        <button type="button" onClick={()=>setQuestion(`Explain the visible trend and volatility evidence for ${productId}.`)}>Explain trend and volatility</button>
      </div>
      <label className="advisor-retention"><input type="checkbox" checked={encrypted} onChange={(event) => setEncrypted(event.target.checked)} /><LockKeyhole size={14} /> Keep this conversation encrypted on this profile</label>
      <button type="button" className="button-primary advisor-send" disabled={busy || selected?.credentialState !== 'connected' || question.trim().length === 0} onClick={() => void send()}><Send size={14} /> {busy ? 'Working…' : 'Send'}</button>
      {history.kind === 'ready' && history.value.conversations.length > 0 && <section className="advisor-history"><h3>Saved conversations</h3><ul>{history.value.conversations.slice(0, 5).map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.retention} · {item.messages.length} messages</small></span><div><button type="button" aria-label={`Export ${item.title}`} onClick={() => void exportHistory.run({ commandId: crypto.randomUUID(), conversationId: item.id })}><Download size={13} /></button><button type="button" aria-label={`Delete ${item.title}`} onClick={() => void removeHistory.run({ commandId: crypto.randomUUID(), conversationId: item.id, confirmed: true })}><Trash2 size={13} /></button></div></li>)}</ul></section>}
      <small>Session memory is the default. Cloud context is sent only when you press Generate or Send.</small>
    </section>
  </div>, document.body);
}
