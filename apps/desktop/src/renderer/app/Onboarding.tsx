import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { Bot, Check, ChevronLeft, ChevronRight, ClipboardPaste, ExternalLink, KeyRound, ShieldCheck, WalletCards, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
import { useDialogFocus } from './use-dialog-focus.js';
import { useWorkspace } from './WorkspaceContext.js';

type Step = 'name' | 'safety' | 'exchange' | 'portfolio' | 'advisor' | 'done';
type Provider = 'coinbase' | 'robinhood_crypto';
type AiProvider = 'openai' | 'gemini' | 'anthropic';
type RobinhoodSetup = ChannelResponse<'connections.robinhood.keypair.begin'>;
type AdvisorSample = ChannelResponse<'advisor.facts.generate'>;
const PERSON_INVALIDATIONS = ['app.person', 'app.onboarding.status'] as const;
const CONNECTION_INVALIDATIONS = ['connections.list', 'portfolio.current', 'app.profile-readiness', 'app.onboarding.status'] as const;
const ROBINHOOD_SETUP_INVALIDATIONS = ['connections.robinhood.keypair.status'] as const;
const AI_LINKS: Readonly<Record<AiProvider, string>> = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/app/apikey', anthropic: 'https://console.anthropic.com/settings/keys' };
const SAMPLE_EVIDENCE = [{ label: 'Safety boundary', value: 'Paper only; live execution is unavailable.', tone: 'neutral' as const }];

function GuideLink({ href, children }: { readonly href: string; readonly children: ReactNode }): React.JSX.Element {
  return <a className="button-secondary" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={14} aria-hidden="true" /></a>;
}

export function Onboarding({ client }: { readonly client: CoquiClient }): React.JSX.Element | null {
  const workspace = useWorkspace();
  const person = useChannel(client, 'app.onboarding.status', {});
  const readiness = useChannel(client, 'app.profile-readiness', {});
  const providers = useChannel(client, 'advisor.providers', {});
  const profiles = useChannel(client, 'accounts.profiles', {});
  const settings = useChannel(client, 'accounts.settings', {});
  const pendingRobinhood = useChannel(client, 'connections.robinhood.keypair.status', {});
  const setPerson = useCommand(client, 'app.person.set', PERSON_INVALIDATIONS);
  const skip = useCommand(client, 'app.onboarding.skip', PERSON_INVALIDATIONS);
  const complete = useCommand(client, 'app.onboarding.complete', PERSON_INVALIDATIONS);
  const connectFile = useCommand(client, 'connections.connect-file', CONNECTION_INVALIDATIONS);
  const beginRobinhood = useCommand(client, 'connections.robinhood.keypair.begin', ROBINHOOD_SETUP_INVALIDATIONS);
  const completeRobinhood = useCommand(client, 'connections.robinhood.keypair.complete', [...CONNECTION_INVALIDATIONS, ...ROBINHOOD_SETUP_INVALIDATIONS]);
  const cancelRobinhood = useCommand(client, 'connections.robinhood.keypair.cancel', ROBINHOOD_SETUP_INVALIDATIONS);
  const connectAi = useCommand(client, 'advisor.provider.connect-copied', ['advisor.providers']);
  const [step, setStep] = useState<Step>('name');
  const [displayName, setDisplayName] = useState('');
  const [provider, setProvider] = useState<Provider>('coinbase');
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai');
  const [clearClipboard, setClearClipboard] = useState(true);
  const [robinhoodSetup, setRobinhoodSetup] = useState<RobinhoodSetup | null>(null);
  const [advisorSample, setAdvisorSample] = useState<AdvisorSample | 'loading' | 'failed' | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const close = (): void => { void skip.run({ commandId: crypto.randomUUID() }); };
  const finish = (): void => {
    if (readiness.kind === 'ready' && readiness.value.portfolioReady) void complete.run({ commandId: crypto.randomUUID() });
    else close();
  };
  useDialogFocus(dialog, close);
  useEffect(() => {
    if (beginRobinhood.state.kind === 'succeeded' && beginRobinhood.value !== null) setRobinhoodSetup(beginRobinhood.value);
  }, [beginRobinhood.state.kind, beginRobinhood.value]);
  useEffect(() => {
    if (pendingRobinhood.kind !== 'ready') return;
    if (pendingRobinhood.value.state === 'pending' && pendingRobinhood.value.setup !== null) {
      setRobinhoodSetup(pendingRobinhood.value.setup);
      setProvider('robinhood_crypto');
    } else if (pendingRobinhood.value.state === 'none') setRobinhoodSetup(null);
  }, [pendingRobinhood]);
  useEffect(() => {
    if (person.kind === 'ready' && person.value.displayName !== null && step === 'name' && displayName.length === 0) {
      setDisplayName(person.value.displayName);
      if (person.value.introState === 'in_progress') setStep('safety');
    }
  }, [displayName.length, person, step]);

  if (person.kind !== 'ready' || readiness.kind !== 'ready') return null;
  if (person.value.introState === 'skipped' || person.value.introState === 'portfolio_ready') return null;
  const returning = readiness.value.steps[0]?.status === 'complete' || readiness.value.firstDecisionComplete ||
    (profiles.kind === 'ready' && profiles.value.profiles.length > 1) ||
    (settings.kind === 'ready' && settings.value.source === 'saved');
  const saveName = async (): Promise<void> => {
    await setPerson.run({ commandId: crypto.randomUUID(), displayName });
    if (!returning) await workspace.setMode('simple');
    setStep(returning ? 'done' : 'safety');
  };
  const connectionError = connectFile.state.kind === 'failed' ? connectFile.state.codes : completeRobinhood.state.kind === 'failed' ? completeRobinhood.state.codes : null;
  const tryAdvisorSample = async (): Promise<void> => {
    setAdvisorSample('loading');
    const prepared = await client.query('advisor.context.prepare', { productId: 'BTC-USD', bars: [],
      evidence: SAMPLE_EVIDENCE, portfolio: [],
      scope: { chartData: false, visibleEvidence: true, sanitizedPortfolio: false } });
    if (prepared.status !== 'ok') { setAdvisorSample('failed'); return; }
    const generated = await client.query('advisor.facts.generate', { commandId: crypto.randomUUID(),
      contextHash: prepared.value.contextHash, provider: aiProvider });
    setAdvisorSample(generated.status === 'ok' ? generated.value : 'failed');
  };

  return <div className="onboarding-backdrop">
    <section ref={dialog} className={`onboarding-dialog onboarding-${returning ? 'returning' : step}`} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="onboarding-header"><div className="onboarding-brand"><img src={new URL('../coqui-mark.png', import.meta.url).href} alt="" /><span><strong>Coqui</strong><small>Paper portfolio workstation</small></span></div><button type="button" className="icon-button" aria-label="Skip setup" onClick={close}><X size={18} /></button></header>
      {!returning && <div className="onboarding-progress" aria-label={`Setup step ${['name','safety','exchange','portfolio','advisor','done'].indexOf(step) + 1} of 6`}>{['name','safety','exchange','portfolio','advisor','done'].map((item) => <span key={item} className={item === step ? 'active' : ''} />)}</div>}

      {step === 'name' && <div className="onboarding-body onboarding-centered"><p className="eyebrow">Welcome</p><h1 id="onboarding-title">What should Coqui call you?</h1><p>Your display name stays on this device. It is separate from portfolio profiles and never enters financial evidence or AI requests.</p><form onSubmit={(event) => { event.preventDefault(); void saveName(); }}><label>Your name<input autoFocus value={displayName} maxLength={40} autoComplete="name" onChange={(event) => setDisplayName(event.target.value)} placeholder="Name" /></label><button className="button-primary" type="submit" disabled={displayName.trim().length === 0 || setPerson.state.kind === 'pending'}>Continue<ChevronRight size={15} /></button></form>{returning && <button type="button" className="button-quiet" onClick={close}>Not now</button>}</div>}

      {step === 'safety' && <div className="onboarding-body"><p className="eyebrow">Before connecting</p><h1 id="onboarding-title">You stay in control</h1><div className="onboarding-boundaries"><article><WalletCards aria-hidden="true" /><div><strong>Read-only account visibility</strong><p>Exchange connections show balances and account state. Coqui rejects excessive Coinbase permissions.</p></div></article><article><ShieldCheck aria-hidden="true" /><div><strong>Paper trading only</strong><p>Live order submission remains disabled in the application build.</p></div></article><article><Bot aria-hidden="true" /><div><strong>AI explains recorded facts</strong><p>Optional providers cannot trade, change strategy settings, or approve research candidates.</p></div></article></div><div className="onboarding-actions"><button className="button-secondary" type="button" onClick={() => setStep('name')}><ChevronLeft size={15} />Back</button><button className="button-primary" type="button" onClick={() => setStep('exchange')}>Choose an exchange<ChevronRight size={15} /></button></div></div>}

      {step === 'exchange' && <div className="onboarding-body"><p className="eyebrow">Optional connection</p><h1 id="onboarding-title">Connect your portfolio</h1><div className="onboarding-provider-tabs" role="tablist"><button type="button" role="tab" aria-selected={provider === 'coinbase'} onClick={() => setProvider('coinbase')}>Coinbase</button><button type="button" role="tab" aria-selected={provider === 'robinhood_crypto'} onClick={() => setProvider('robinhood_crypto')}>Robinhood Crypto</button></div>
        {provider === 'coinbase' ? <div className="onboarding-guide"><ol><li>Open Coinbase Developer Platform.</li><li>Create a Secret or Server API key for this portfolio.</li><li>Select Ed25519 when available.</li><li>Enable View only. Disable Trade and Transfer.</li><li>Download the JSON key file, then select it below.</li></ol><div className="onboarding-inline-actions"><GuideLink href="https://portal.cdp.coinbase.com/access/api">Open Coinbase</GuideLink><GuideLink href="https://docs.cdp.coinbase.com/api-reference/authentication">Read authentication guide</GuideLink><button className="button-primary" type="button" disabled={connectFile.state.kind === 'pending'} onClick={() => void connectFile.run({ commandId: crypto.randomUUID(), provider: 'coinbase' })}><KeyRound size={15} />{connectFile.state.kind === 'pending' ? 'Verifying and syncing…' : 'Choose key file'}</button></div></div>
        : <div className="onboarding-guide"><ol><li>Generate a key pair. The private key stays in your OS keychain.</li><li>Register the public key in Robinhood Crypto settings.</li><li>Copy the API key Robinhood gives you.</li><li>Return here and explicitly import the copied API key.</li></ol>{pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'unavailable' && <SurfaceState kind="error" title="Pending setup cannot be resumed" detail="The matching private key is unavailable. Start over to create a new pair." compact />}{robinhoodSetup === null ? <div className="onboarding-inline-actions"><GuideLink href="https://robinhood.com/account/crypto-api">Open Robinhood</GuideLink><GuideLink href="https://docs.robinhood.com/crypto/trading/">Read API guide</GuideLink><button className="button-primary" type="button" disabled={beginRobinhood.state.kind === 'pending' || pendingRobinhood.kind === 'loading'} onClick={() => void beginRobinhood.run({ commandId: crypto.randomUUID() })}><KeyRound size={15} />{pendingRobinhood.kind === 'loading' ? 'Checking for saved setup…' : pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'unavailable' ? 'Start over with a new key pair' : 'Generate key pair'}</button></div> : <div className="onboarding-public-key"><span><strong>{pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'pending' ? 'Setup restored · public key' : 'Public key'}</strong><small>Safe to register with Robinhood. The private key is in the OS keychain.</small></span><code>{robinhoodSetup.publicKeyBase64}</code><button className="button-primary" type="button" disabled={completeRobinhood.state.kind === 'pending'} onClick={() => void completeRobinhood.run({ commandId: crypto.randomUUID(), setupId: robinhoodSetup.setupId })}><ClipboardPaste size={15} />Import copied API key</button><button className="button-quiet" type="button" onClick={() => { void cancelRobinhood.run({ commandId: crypto.randomUUID(), setupId: robinhoodSetup.setupId }); setRobinhoodSetup(null); }}>Cancel and remove pending key</button></div>}<details><summary>Advanced: import an existing key pair</summary><p>Select a JSON file containing <code>apiKey</code> and <code>privateKeyBase64</code>.</p><button className="button-secondary" type="button" onClick={() => void connectFile.run({ commandId: crypto.randomUUID(), provider: 'robinhood_crypto' })}>Choose JSON file</button></details></div>}
        {connectionError !== null && <SurfaceState kind="error" title="Connection not ready" detail={connectionError.join(', ').replaceAll('_', ' ')} compact />}
        {(connectFile.state.kind === 'succeeded' || completeRobinhood.state.kind === 'succeeded') && <SurfaceState kind="success" title="Credentials verified" detail="Coqui synchronized the account. Portfolio readiness is checked separately." compact />}
        <div className="onboarding-actions"><button className="button-secondary" type="button" onClick={() => setStep('safety')}><ChevronLeft size={15} />Back</button><button className="button-primary" type="button" onClick={() => setStep(readiness.value.portfolioReady ? 'advisor' : 'portfolio')}>{readiness.value.portfolioReady ? 'Continue' : 'Skip for now'}<ChevronRight size={15} /></button></div></div>}

      {step === 'portfolio' && <div className="onboarding-body onboarding-centered"><p className="eyebrow">Portfolio readiness</p><h1 id="onboarding-title">Connection setup is resumable</h1><p>{readiness.value.portfolioReady ? 'Your connected portfolio is complete and ready.' : 'Coqui needs a complete, nonempty connected portfolio before financial readiness can advance. You can continue now and resume from Overview.'}</p><SurfaceState kind={readiness.value.portfolioReady ? 'success' : 'blocked'} title={readiness.value.portfolioReady ? 'Portfolio ready' : 'Portfolio not ready'} detail={readiness.value.steps.find((item) => item.id === 'portfolio')?.detail ?? 'Connected portfolio evidence is unavailable.'} /><div className="onboarding-actions"><button className="button-secondary" type="button" onClick={() => setStep('exchange')}><ChevronLeft size={15} />Back</button><button className="button-primary" type="button" onClick={() => setStep(readiness.value.portfolioReady ? 'advisor' : 'done')}>{readiness.value.portfolioReady ? 'Continue to optional AI' : 'Open Coqui'}<ChevronRight size={15} /></button></div></div>}

      {step === 'advisor' && <div className="onboarding-body"><p className="eyebrow">Optional enhancement</p><h1 id="onboarding-title">Add an AI explanation provider</h1><p>Local explanations always work without an API key. A connected provider can only rephrase the bounded evidence pack you approve.</p><div className="onboarding-ai-grid">{(['openai','gemini','anthropic'] as const).map((item) => <button type="button" key={item} aria-pressed={aiProvider === item} onClick={() => { setAiProvider(item); setAdvisorSample(null); }}><strong>{item === 'openai' ? 'OpenAI' : item === 'gemini' ? 'Gemini' : 'Anthropic'}</strong><small>Optional provider charges may apply</small></button>)}</div><div className="onboarding-guide"><p>Use a dedicated key and review provider usage controls. No exchange credentials or execution authority are shared.</p><div className="onboarding-inline-actions"><GuideLink href={AI_LINKS[aiProvider]}>Open key settings</GuideLink><button className="button-primary" type="button" disabled={connectAi.state.kind === 'pending'} onClick={() => void connectAi.run({ commandId: crypto.randomUUID(), provider: aiProvider, clearClipboard, confirmed: true })}><ClipboardPaste size={15} />Import copied key</button></div><label className="onboarding-check"><input type="checkbox" checked={clearClipboard} onChange={(event) => setClearClipboard(event.target.checked)} />Clear the copied key afterward if it is still on the clipboard</label></div>{connectAi.state.kind === 'succeeded' && <div className="onboarding-sample"><SurfaceState kind="success" title="AI provider verified" detail={`${connectAi.value?.provider ?? aiProvider} is available for evidence-bound explanations.`} compact /><p><strong>Sample evidence that will be sent</strong><code>{JSON.stringify(SAMPLE_EVIDENCE)}</code></p><button type="button" className="button-secondary" disabled={advisorSample === 'loading'} onClick={() => void tryAdvisorSample()}>{advisorSample === 'loading' ? 'Requesting rephrasing…' : 'Try one cloud rephrasing'}</button>{advisorSample !== null && advisorSample !== 'loading' && advisorSample !== 'failed' && <p className="onboarding-sample-answer">{advisorSample.text}<small>{advisorSample.provider} · advisory only · no execution authority</small></p>}{advisorSample === 'failed' && <SurfaceState kind="error" title="Sample unavailable" detail="Local explanations remain available. No trading or host state was affected." compact />}</div>}{connectAi.state.kind === 'failed' && <SurfaceState kind="error" title="Provider not connected" detail={connectAi.state.codes.join(', ').replaceAll('_', ' ')} compact />}<div className="onboarding-actions"><button className="button-secondary" type="button" onClick={() => setStep(readiness.value.portfolioReady ? 'exchange' : 'portfolio')}><ChevronLeft size={15} />Back</button><button className="button-primary" type="button" onClick={() => setStep('done')}>{providers.kind === 'ready' && providers.value.providers.some((item) => item.credentialState === 'connected') ? 'Continue' : 'Skip AI'}<ChevronRight size={15} /></button></div></div>}

      {step === 'done' && <div className="onboarding-body onboarding-centered"><Check className="onboarding-done-icon" size={34} aria-hidden="true" /><p className="eyebrow">Setup saved</p><h1 id="onboarding-title">{readiness.value.portfolioReady ? 'Your portfolio is ready' : 'Continue at your own pace'}</h1><p>Overview will keep a readiness guide visible until Coqui records the first paper decision. Every optional step can be resumed from Settings.</p><button className="button-primary" type="button" onClick={finish}>Open Coqui</button></div>}
      {!returning && step !== 'done' && <button type="button" className="onboarding-skip" onClick={close}>Skip setup</button>}
    </section>
  </div>;
}
