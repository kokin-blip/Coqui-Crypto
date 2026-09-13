import { describe, expect, it } from 'vitest';

import {
  issueSchema,
  transportFailure,
  TRANSPORT_ISSUE_CODES,
} from '../packages/contracts/src/index.js';

describe('transport failures', () => {
  it('reports a boundary failure in the same shape as a service issue', () => {
    for (const code of TRANSPORT_ISSUE_CODES) {
      const outcome = transportFailure(code);
      expect(outcome.status).toBe('failed');
      expect(outcome.status === 'failed' && outcome.issues[0]).toEqual({
        path: ['transport'], code,
      });
      expect(issueSchema.safeParse({ path: ['transport'], code }).success).toBe(true);
    }
  });
});
