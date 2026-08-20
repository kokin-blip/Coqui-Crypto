import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

const serviceRoot = resolve(process.cwd(), 'packages/services/src');
const domainServices = new Set([
  'accounts',
  'advisor',
  'alerts',
  'ingest',
  'market-data',
  'paper',
  'portfolio',
  'research',
  'risk',
  'scheduler',
]);

type DependencyGraph = ReadonlyMap<string, ReadonlySet<string>>;

function typescriptFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return typescriptFiles(child);
    return entry.isFile() && entry.name.endsWith('.ts') ? [child] : [];
  });
}

function serviceName(path: string): string | null {
  const [name] = relative(serviceRoot, path).split(sep);
  return name && domainServices.has(name) ? name : null;
}

function importedSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

function serviceGraph(): Map<string, Set<string>> {
  const graph = new Map([...domainServices].map((name) => [name, new Set<string>()]));
  for (const path of typescriptFiles(serviceRoot)) {
    const owner = serviceName(path);
    if (!owner) continue;
    for (const specifier of importedSpecifiers(path)) {
      if (!specifier.startsWith('.')) continue;
      const target = serviceName(resolve(dirname(path), specifier));
      if (target && target !== owner) graph.get(owner)!.add(target);
    }
  }
  return graph;
}

function dependencyCycle(graph: DependencyGraph): readonly string[] | null {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): readonly string[] | null {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

describe('service dependency graph', () => {
  it('is acyclic and keeps every service at no more than two service dependencies', () => {
    const graph = serviceGraph();
    expect(dependencyCycle(graph)).toBeNull();
    for (const dependencies of graph.values()) expect(dependencies.size).toBeLessThanOrEqual(2);
  });

  it('detects a representative cycle', () => {
    const graph = new Map<string, ReadonlySet<string>>([
      ['portfolio', new Set(['risk'])],
      ['risk', new Set(['alerts'])],
      ['alerts', new Set(['portfolio'])],
    ]);
    expect(dependencyCycle(graph)).toEqual(['portfolio', 'risk', 'alerts', 'portfolio']);
  });
});
