import { useState } from 'react';
import { KeyRound, PackageCheck, ShieldCheck, Trash2, X } from 'lucide-react';

import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const INVALIDATE = ['chart-extensions.catalog'] as const;

export function ChartExtensionManager({ client, onClose }: {
  readonly client: CoquiClient; readonly onClose: () => void;
}): React.JSX.Element {
  const catalog = useChannel(client, 'chart-extensions.catalog', {});
  const trust = useCommand(client, 'chart-extensions.signer.trust', INVALIDATE);
  const install = useCommand(client, 'chart-extensions.install', INVALIDATE);
  const setState = useCommand(client, 'chart-extensions.set', INVALIDATE);
  const remove = useCommand(client, 'chart-extensions.remove', INVALIDATE);
  const removeSigner = useCommand(client, 'chart-extensions.signer.remove', INVALIDATE);
  const [signerName, setSignerName] = useState('Owner key');
  const [publicKey, setPublicKey] = useState('');
  const [packageJson, setPackageJson] = useState('');
  const value = catalog.kind === 'ready' ? catalog.value : { extensions: [], signers: [] };
  return <div className="extension-manager-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="extension-manager" role="dialog" aria-modal="true" aria-labelledby="extensions-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="violet-kicker"><PackageCheck size={13} /> Presentation only</span><h2 id="extensions-title">Chart extensions</h2></div><button type="button" className="icon-button" aria-label="Close extension manager" onClick={onClose}><X size={17} /></button></header>
      <div className="extension-safety"><ShieldCheck size={18} /><div><strong>Signed, isolated output</strong><span>Packages cannot run JavaScript, access files or networking, or contribute to research, risk, proposals, or execution.</span></div></div>
      <section><h3>Installed</h3>{value.extensions.length === 0 ? <p className="extension-empty">No chart extensions installed.</p> : <ul className="extension-list">{value.extensions.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.id} · v{item.version} · {item.author}</span><small>{item.enabled ? 'Enabled' : 'Disabled'} · signer {item.signerKeyId.slice(0, 10)}…</small></div><div><button type="button" onClick={() => void setState.run({ commandId: crypto.randomUUID(), extensionId: item.id, enabled: !item.enabled, settings: item.settings })}>{item.enabled ? 'Disable' : 'Enable'}</button><button type="button" className="danger-quiet" aria-label={`Uninstall ${item.name}`} onClick={() => void remove.run({ commandId: crypto.randomUUID(), extensionId: item.id, confirmed: true })}><Trash2 size={14} /></button></div></li>)}</ul>}</section>
      <section><h3>Install signed package</h3><label className="extension-field"><span>Canonical .coquichart JSON</span><textarea value={packageJson} onChange={(event) => setPackageJson(event.target.value)} placeholder='{"format":"coqui-chart-extension-v1",…}' /></label><button type="button" disabled={packageJson.trim().length === 0 || install.state.kind === 'pending'} onClick={() => void install.run({ commandId: crypto.randomUUID(), packageJson, confirmed: true })}>Verify signature and install</button></section>
      <section><h3>Trusted owner keys</h3><div className="extension-key-form"><label className="extension-field"><span>Display name</span><input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label><label className="extension-field"><span>Ed25519 public key (DER, base64)</span><input value={publicKey} onChange={(event) => setPublicKey(event.target.value)} /></label><button type="button" disabled={publicKey.trim().length === 0 || trust.state.kind === 'pending'} onClick={() => void trust.run({ commandId: crypto.randomUUID(), displayName: signerName, publicKeyBase64: publicKey, confirmed: true })}><KeyRound size={14} /> Trust owner key</button></div><ul className="extension-signer-list">{value.signers.map((signer) => <li key={signer.keyId}><span><strong>{signer.displayName}</strong><small>{signer.revokedAtMs === null ? 'Trusted' : 'Revoked'} · {signer.keyId.slice(0, 12)}…</small></span>{signer.revokedAtMs === null && <button type="button" onClick={() => void removeSigner.run({ commandId: crypto.randomUUID(), keyId: signer.keyId, confirmed: true })}>Remove trust</button>}</li>)}</ul></section>
      <footer>Declarative series and optional import-free WebAssembly only · Advisory display surface</footer>
    </section>
  </div>;
}
