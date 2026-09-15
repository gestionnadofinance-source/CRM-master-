export function entityUrl(crmSlug: string, entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "CLIENT":
      return `/c/${crmSlug}/clients/${entityId}`;
    case "PROSPECT":
      return `/c/${crmSlug}/prospects/${entityId}`;
    case "QUOTE":
      return `/c/${crmSlug}/quotes/${entityId}`;
    case "APPOINTMENT":
      return `/c/${crmSlug}/agenda?appointment=${entityId}`;
    case "TASK":
      return `/c/${crmSlug}/tasks?task=${entityId}`;
    case "MESSAGE_THREAD":
      return `/c/${crmSlug}/messages?thread=${entityId}`;
    case "CHANTIER":
      return `/c/${crmSlug}/planning`;
    case "VAULT_DOCUMENT":
      return `/c/${crmSlug}/vault`;
    default:
      return null;
  }
}
