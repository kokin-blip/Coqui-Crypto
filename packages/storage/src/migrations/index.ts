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
import { migrations38 } from './v38.js';
import { migrations39 } from './v39.js';
import { migrations40 } from './v40.js';
import { migrations41 } from './v41.js';
import { migrations42 } from './v42.js';
import { migrations43 } from './v43.js';
import { migrations44 } from './v44.js';
import { migrations45 } from './v45.js';

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
  ...migrations38,
  ...migrations39,
  ...migrations40,
  ...migrations41,
  ...migrations42,
  ...migrations43,
  ...migrations44,
  ...migrations45,
] as const;
