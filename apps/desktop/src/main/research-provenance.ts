import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '@coqui/core';

/** Diagnostic artifact hash over application workspace modules/assets, separate from behavior manifests. */
export function fullApplicationArtifactHash(): string {
  const main = dirname(fileURLToPath(import.meta.url));
  const roots = [join(main,'..'), ...['core','adapters','storage','services','contracts','observability','ui-kit']
    .map((name) => dirname(fileURLToPath(import.meta.resolve(`@coqui/${name}`))))];
  const material: [string,string][] = [];
  const visit = (root: string, relative: string, index: number) => {
    for (const item of readdirSync(join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(relative,item.name);
      if (item.isDirectory()) visit(root,path,index);
      else if (item.isFile()) material.push([`${index}/${path}`,sha256Hex(readFileSync(join(root,path)).toString('base64'))]);
    }
  };
  roots.forEach((root,index)=>visit(root,'',index));
  return sha256Hex(JSON.stringify(material));
}
