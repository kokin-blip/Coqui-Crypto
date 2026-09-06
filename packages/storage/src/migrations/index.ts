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
import { migrations46 } from './v46.js';
import { migrations47 } from './v47.js';
import { migrations48 } from './v48.js';
import { migrations49 } from './v49.js';
import { migrations50 } from './v50.js';
import { migrations51 } from './v51.js';
import { migrations52 } from './v52.js';
import { migrations53 } from './v53.js';
import { migrations54 } from './v54.js';
import { migrations55 } from './v55.js';
import { migrations56 } from './v56.js';
import { migrations57 } from './v57.js';
import { migrations58 } from './v58.js';
import { migrations59 } from './v59.js';
import { migrations60 } from './v60.js';
import { migrations61 } from './v61.js';
import { migrations62 } from './v62.js';
import { migrations63 } from './v63.js';
import { migrations64 } from './v64.js';
import { migrations65 } from './v65.js';
import { migrations66 } from './v66.js';
import { migrations67 } from './v67.js';
import { migrations68 } from './v68.js';

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
  ...migrations46,
  ...migrations47,
  ...migrations48,
  ...migrations49,
  ...migrations50,
  ...migrations51,
  ...migrations52,
  ...migrations53,
  ...migrations54,
  ...migrations55,
  ...migrations56,
  ...migrations57,
  ...migrations58,
  ...migrations59,
  ...migrations60,
  ...migrations61,
  ...migrations62,
  ...migrations63,
  ...migrations64,
  ...migrations65,
  ...migrations66,
  ...migrations67,
  ...migrations68,
] as const;
