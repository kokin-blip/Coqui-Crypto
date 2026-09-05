import type { ActionState } from '@coqui/ui-kit';

export const COINBASE_REASON_COPY = {
  credential_missing: 'The saved profile identity has no matching credential in the OS secret store.',
  credential_invalid: 'The stored credential is malformed and must be replaced.',
  manifest_identity_missing: 'The credential exists, but its profile identity record is incomplete.',
  identity_mismatch: 'The credential no longer matches this profile identity.',
  portfolio_identity_missing: 'Coinbase portfolio identity verification must be completed again.',
  secret_store_unavailable: 'The OS credential store is unavailable. Coqui will not use a plaintext fallback.',
} as const;

const ISSUE_COPY: Readonly<Record<string, string>> = {
  invalid_profile_id: 'Select a valid profile before continuing.',
  profile_not_found: 'This profile is no longer available. Select another profile.',
  invalid_request_time: 'The request time is invalid. Check the system clock.',
  clock_unavailable: 'The system clock is unavailable. Sync was not started.',
  coinbase_connection_invalid_clock: 'Check the system clock before verifying a credential.',
  coinbase_verification_http: 'Coinbase could not complete verification. Try again later.',
  coinbase_verification_failed: 'The credential could not be verified. No connection was confirmed.',
  profile_store_unavailable: 'The profile store is unavailable. Restore access before continuing.',
  profile_store_corrupt: 'The profile store failed validation. Review profile recovery before continuing.',
  profile_store_conflict: 'The profile changed during this operation. Review its current connection state.',
  profile_store_rejected: 'The profile store rejected the operation.',
  invalid_coinbase_key_file: 'Choose an unmodified Coinbase CDP API key JSON file.',
  invalid_key_name: 'The key name in this file is invalid.',
  invalid_private_key: 'The private key in this file is invalid.',
  coinbase_verification_timeout: 'Coinbase did not respond before the verification timeout. Try again later.',
  coinbase_verification_network: 'Coinbase could not be reached. Check the network and try again.',
  coinbase_verification_cancelled: 'Credential verification was cancelled.',
  coinbase_verification_shutdown: 'Credential verification stopped because Coqui is shutting down.',
  coinbase_verification_elapsed_budget: 'Coinbase verification exceeded its safe elapsed-time budget.',
  coinbase_verification_unauthorized: 'Coinbase rejected this API key.',
  coinbase_verification_forbidden: 'Coinbase does not permit this key to read the required account data.',
  coinbase_verification_rate_limited: 'Coinbase rate-limited verification. Wait before trying again.',
  coinbase_verification_invalid_permissions: 'Coinbase returned an invalid permission response.',
  coinbase_verification_missing_view_permission: 'This key does not have the required view permission.',
  coinbase_verification_excess_permissions: 'This key can trade or transfer. Create a view-only key instead.',
  coinbase_verification_accounts_unreadable: 'This key cannot read the Coinbase accounts required for verification.',
  coinbase_portfolio_identity_invalid: 'Coinbase returned an invalid portfolio identity.',
  duplicate_coinbase_connection: 'This Coinbase key or portfolio is already assigned to another Coqui profile.',
  secret_store_unavailable: 'The OS credential store is unavailable. No credential was saved.',
  secret_store_rejected: 'The OS credential store rejected the operation.',
  profile_operation_in_progress: 'Another profile operation is still in progress.',
  coinbase_connection_recovery_required: 'Credential publication could not be completed safely. Review the connection state before retrying.',
  credentials_unavailable: 'Connect a verified view-only Coinbase key before syncing.',
  credentials_invalid: 'The stored Coinbase credential is invalid and must be replaced.',
  authentication_failed: 'Coinbase rejected the stored credential.',
  provider_unavailable: 'Coinbase is temporarily unavailable. Existing evidence was preserved.',
  rate_limited: 'Coinbase rate-limited this sync. Wait before trying again.',
  elapsed_budget_exhausted: 'The sync exceeded its five-minute acquisition budget.',
  data_invalid: 'Coinbase returned data that did not pass Coqui validation.',
  storage_rejected: 'The immutable evidence store rejected the sync.',
  cancelled: 'The sync was cancelled.',
  shutdown: 'The sync stopped because Coqui is shutting down.',
  unexpected_failure: 'The operation could not be confirmed. Review the connection and evidence state.',
};

export function coinbaseIssueCopy(code: string): string {
  return ISSUE_COPY[code] ?? `Coinbase operation failed (${code.replaceAll('_', ' ')}).`;
}

export function actionFailureCopy(state: ActionState): string | null {
  if (state.kind !== 'failed' && state.kind !== 'blocked' && state.kind !== 'unknown') return null;
  const lead = state.kind === 'unknown' ? 'Outcome unconfirmed. Do not retry yet.' : state.kind === 'blocked' ? 'Blocked.' : 'Not completed.';
  return `${lead} ${state.codes.map(coinbaseIssueCopy).join(' ')}`;
}
