import { migrations1To8 } from './v1-v8.js';
import { migrations9To17 } from './v9-v17.js';
import { migrations18To23 } from './v18-v23.js';
import { migrations24To28 } from './v24-v28.js';
import { migrations29 } from './v29.js';
import { migrations30 } from './v30.js';
import { migrations31 } from './v31.js';
import { migrations32 } from './v32.js';
import { migrations33 } from './v33.js';
import { migrations34 } from './v34.js';
import { migrations35 } from './v35.js';
import { migrations36 } from './v36.js';
import { migrations37 } from './v37.js';

export type { Migration, MigrationDatabase } from './types.js';

/** All predecessor migrations in their original, immutable numbering. */
export const migrations = [
  ...migrations1To8,
  ...migrations9To17,
  ...migrations18To23,
  ...migrations24To28,
  ...migrations29,
  ...migrations30,
  ...migrations31,
  ...migrations32,
  ...migrations33,
  ...migrations34,
  ...migrations35,
  ...migrations36,
  ...migrations37,
] as const;
