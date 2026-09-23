export function entityUrl(crmSlug: string, entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "CHANTIER":
      return `/c/${crmSlug}/planning`;
    case "VAULT_DOCUMENT":
      return `/c/${crmSlug}/vault`;
    default:
      return null;
  }
}
