import { PencilRuler, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ChartDrawing } from './chart-workstation-types.js';

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function DrawingEditor({ drawing, onSave, onDelete }: {
  readonly drawing: ChartDrawing;
  readonly onSave: (drawing: ChartDrawing) => void;
  readonly onDelete: (id: string) => void;
}): React.JSX.Element {
  const [label, setLabel] = useState(drawing.label ?? '');
  const [points, setPoints] = useState(() => drawing.points.map((point) => ({
    timeMs: String(point.timeMs), value: point.value,
  })));
  const valid = points.length > 0 && points.every((point) =>
    /^\d+$/u.test(point.timeMs) && Number.isSafeInteger(Number(point.timeMs)) && DECIMAL.test(point.value));
  return <li><details><summary>{drawing.kind}<span>{drawing.label ?? `${drawing.points.length} point${drawing.points.length === 1 ? '' : 's'}`}</span></summary>
    <form onSubmit={(event) => { event.preventDefault(); if (!valid) return; onSave({ ...drawing,
      label: label.trim() === '' ? null : label.trim(), points: points.map((point) => ({
        timeMs: Number(point.timeMs), value: point.value,
      })) }); }}>
      <label>Label<input maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      {points.map((point, index) => <fieldset key={index}><legend>Point {index + 1}</legend>
        <label>UTC milliseconds<input inputMode="numeric" value={point.timeMs} onChange={(event) =>
          setPoints((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, timeMs: event.target.value } : item))} /></label>
        <label>Exact value<input inputMode="decimal" value={point.value} onChange={(event) =>
          setPoints((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /></label>
      </fieldset>)}
      {!valid && <span className="drawing-validation" role="alert">Use non-negative exact values and UTC millisecond timestamps.</span>}
      <div><button type="submit" className="button-secondary" disabled={!valid}>Save drawing</button><button type="button" className="button-danger" onClick={() => onDelete(drawing.id)}><Trash2 size={12} /> Delete</button></div>
    </form>
  </details></li>;
}

export function ChartDrawingManager({ drawings, onSave, onDelete }: {
  readonly drawings: readonly ChartDrawing[];
  readonly onSave: (drawing: ChartDrawing) => void;
  readonly onDelete: (id: string) => void;
}): React.JSX.Element | null {
  if (drawings.length === 0) return null;
  return <details className="chart-drawing-manager">
    <summary><PencilRuler size={12} /> Drawings · {drawings.length}</summary>
    <ul>{drawings.map((drawing) => <DrawingEditor key={drawing.id} drawing={drawing}
      onSave={onSave} onDelete={onDelete} />)}</ul>
  </details>;
}
