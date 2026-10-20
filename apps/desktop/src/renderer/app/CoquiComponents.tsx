import type { ButtonHTMLAttributes,ReactNode,SelectHTMLAttributes } from 'react';

/** Semantic implementations of the reusable components in the Coqui Figma library. */
export function CoquiPanel({title,headingId,controls,children}:{readonly title:string;readonly headingId:string;
  readonly controls?:ReactNode;readonly children:ReactNode}):React.JSX.Element {
  return <section className="terminal-panel coqui-component-panel" aria-labelledby={headingId} data-figma-node="3:64">
    <header data-figma-node="3:66"><h2 id={headingId}>{title}</h2>{controls}</header>{children}</section>;
}
export function CoquiButton(props:ButtonHTMLAttributes<HTMLButtonElement>):React.JSX.Element {
  return <button {...props} type={props.type??'button'} className={`coqui-component-button ${props.className??''}`} data-figma-node="3:37" />;
}
export function CoquiSelect(props:SelectHTMLAttributes<HTMLSelectElement>):React.JSX.Element {
  return <select {...props} className={`coqui-component-select ${props.className??''}`} data-figma-node="3:56" />;
}
export function CoquiBadge({children,tone='neutral'}:{readonly children:ReactNode;
  readonly tone?:'neutral'|'success'|'warning'|'danger'}):React.JSX.Element {
  return <span className="coqui-component-badge" data-tone={tone} data-figma-node="3:46">{children}</span>;
}
