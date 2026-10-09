import type { OverlayCandidate, OverlayModel, OverlayRow, TreeNode } from './types.js';
import { OVERLAY_VERSION } from './types.js';
export function solve(matrix: number[][], target: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, target[i]!]), size = target.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (Math.abs(rows[pivot]![column]!) < 1e-12) throw new Error('overlay_singular_model');
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let index = column; index <= size; index++) rows[column]![index] = rows[column]![index]! / divisor;
    for (let row = 0; row < size; row++) if (row !== column) {
      const factor = rows[row]![column]!;
      for (let index = column; index <= size; index++) rows[row]![index] = rows[row]![index]! - factor * rows[column]![index]!;
    }
  }
  return rows.map((row) => row[size]!);
}
function fitTree(x: readonly number[][], y: readonly number[], minimumLeaf: number, depth = 0): TreeNode {
  const value = y.reduce((s, v) => s + v, 0) / y.length;
  if (depth === 2 || y.length < minimumLeaf * 2) return { value };
  let best: { loss: number; feature: number; split: number; left: number[]; right: number[] } | null = null;
  for (let feature = 0; feature < 5; feature++) {
    const values = [...new Set(x.map((row) => row[feature]!))].sort((a, b) => a - b);
    for (let index = 1; index < values.length; index++) {
      const split = (values[index - 1]! + values[index]!) / 2;
      const left: number[] = [], right: number[] = [];
      x.forEach((row, i) => (row[feature]! <= split ? left : right).push(i));
      if (left.length < minimumLeaf || right.length < minimumLeaf) continue;
      const loss = [left, right].reduce((sum, indices) => {
        const mean = indices.reduce((s, i) => s + y[i]!, 0) / indices.length;
        return sum + indices.reduce((s, i) => s + (y[i]! - mean) ** 2, 0);
      }, 0);
      if (best === null || loss < best.loss - 1e-12) best = { loss, feature, split, left, right };
    }
  }
  if (!best || best.loss >= y.reduce((s, v) => s + (v - value) ** 2, 0) - 1e-12) return { value };
  return { value, feature: best.feature, split: best.split,
    left: fitTree(best.left.map((i) => x[i]!), best.left.map((i) => y[i]!), minimumLeaf, depth + 1),
    right: fitTree(best.right.map((i) => x[i]!), best.right.map((i) => y[i]!), minimumLeaf, depth + 1) };
}
export function trainOverlayModel(rows: readonly OverlayRow[], candidate: OverlayCandidate, boundaryMs: number): OverlayModel {
  const assets = rows[0]?.features.length ?? 0;
  if (!(candidate.model === 'ridge' ? [1, 10] : candidate.model === 'tree' ? [20, 40] : []).includes(candidate.modelParameter) || candidate.model === 'none' || rows.length < 120 || !assets || rows.some((row, i) =>
      row.labelAvailableAtMs >= boundaryMs || row.labelAvailableAtMs < row.labelEndMs || row.executionAtMs >= row.labelEndMs ||
      (i > 0 && row.executionAtMs <= rows[i - 1]!.executionAtMs) || row.features.length !== assets ||
      row.forwardReturns.length !== assets || row.forwardReturns.some((v) => !Number.isFinite(v)) ||
      row.features.some((features) => features.length !== 5 || features.some((v) => !Number.isFinite(v))))) throw new Error('overlay_training_insufficient_or_noncausal');
  const means: number[][] = [], scales: number[][] = [], coefficients: number[][] = [], trees: TreeNode[] = [];
  for (let asset = 0; asset < assets; asset++) {
    const samples = rows.map((row) => [...row.features[asset]!]), y = rows.map((row) => row.forwardReturns[asset]!);
    const mean = Array.from({ length: 5 }, (_, f) => samples.reduce((s, row) => s + row[f]!, 0) / samples.length);
    const scale = mean.map((m, f) => Math.max(1e-8, Math.sqrt(samples.reduce((s, row) => s + (row[f]! - m) ** 2, 0) / samples.length)));
    const x = samples.map((row) => row.map((v, f) => (v - mean[f]!) / scale[f]!));
    means.push(mean); scales.push(scale);
    if (candidate.model === 'tree') { trees.push(fitTree(x, y, candidate.modelParameter)); coefficients.push([]); continue; }
    const gram = Array.from({ length: 6 }, () => Array<number>(6).fill(0)), target = Array<number>(6).fill(0);
    x.forEach((row, index) => {
      const values = [1, ...row];
      for (let i = 0; i < 6; i++) { target[i] = target[i]! + values[i]! * y[index]!;
        for (let j = 0; j < 6; j++) gram[i]![j] = gram[i]![j]! + values[i]! * values[j]!; }
    });
    for (let i = 1; i < 6; i++) gram[i]![i] = gram[i]![i]! + candidate.modelParameter;
    coefficients.push(solve(gram, target));
  }
  return { kind: candidate.model, version: OVERLAY_VERSION, parameter: candidate.modelParameter, means, scales,
    coefficients, trees, trainedThroughMs: Math.max(...rows.map((row) => row.labelAvailableAtMs)) };
}
export function predictOverlayModel(model: OverlayModel, features: readonly (readonly number[])[]): number[] {
  validateOverlayModel(model);
  if (features.length !== model.means.length || features.some((row) => row.length !== 5 || row.some((v) => !Number.isFinite(v)))) throw new Error('overlay_features_invalid');
  const values = features.map((row, asset) => {
    const normalized = row.map((v, f) => (v - model.means[asset]![f]!) / model.scales[asset]![f]!);
    if (model.kind === 'ridge') return model.coefficients[asset]![0]! + normalized.reduce((s, v, f) => s + v * model.coefficients[asset]![f + 1]!, 0);
    let node = model.trees[asset]!;
    while (node.feature !== undefined) node = normalized[node.feature]! <= node.split! ? node.left! : node.right!;
    return node.value;
  });
  if (values.some((v) => !Number.isFinite(v))) throw new Error('overlay_prediction_invalid'); return values;
}

export function validateOverlayModel(model: OverlayModel): void {
  const count = model.means.length;
  const nodeValid = (node: TreeNode, depth: number): boolean => !!node && Number.isFinite(node.value) && (node.feature === undefined
    ? node.left === undefined && node.right === undefined && node.split === undefined
    : depth < 2 && Number.isInteger(node.feature) && node.feature >= 0 && node.feature < 5 && Number.isFinite(node.split) &&
      !!node.left && !!node.right && nodeValid(node.left, depth + 1) && nodeValid(node.right, depth + 1));
  if (model.version !== OVERLAY_VERSION || !count || !Number.isSafeInteger(model.trainedThroughMs) ||
      !(model.kind === 'ridge' ? [1, 10] : model.kind === 'tree' ? [20, 40] : []).includes(model.parameter) ||
      model.scales.length !== count || model.coefficients.length !== count ||
      model.means.some((row) => row.length !== 5 || row.some((v) => !Number.isFinite(v))) ||
      model.scales.some((row) => row.length !== 5 || row.some((v) => !Number.isFinite(v) || v <= 0)) ||
      (model.kind === 'ridge' ? model.trees.length !== 0 || model.coefficients.some((row) => row.length !== 6 || row.some((v) => !Number.isFinite(v)))
        : model.trees.length !== count || model.coefficients.some((row) => row.length !== 0) || model.trees.some((node) => !nodeValid(node, 0))))
    throw new Error('overlay_model_invalid');
}
