import { accountCapitalAuthorityView, assertAccountAuthorityHash, assertAccountAuthorityTime, type AccountCapitalAuthorityPort } from '@coqui/core';
import { getAccountAuthorityHead, type AccountAuthorityJournal } from '@coqui/storage';

/** Explicit injection only. Reads the disabled journal; provides no enrollment or broker capability. */
export function createAccountCapitalAuthorityReadPort(journal: AccountAuthorityJournal): AccountCapitalAuthorityPort {
  return { read: (scopeId, atMs) => {
    assertAccountAuthorityHash(scopeId); assertAccountAuthorityTime(atMs);
    try { return accountCapitalAuthorityView(scopeId, atMs, getAccountAuthorityHead(journal, scopeId)); }
    catch {
      const view = accountCapitalAuthorityView(scopeId, atMs, null);
      return { ...view, reasonCodes: [...view.reasonCodes.filter(reason => reason !== 'account_authority_scope_unrecorded'),
        'account_authority_journal_unreadable'] };
    }
  } };
}
