/** Development only. Production news keys use the existing OS SecretStore. */
export function readNewsApiKeys(environment: Readonly<Record<string, string | undefined>>) {
  return { marketaux: environment['MARKETAUX_API_TOKEN']?.trim() || null,
    currents: environment['CURRENTS_API_KEY']?.trim() || null };
}
