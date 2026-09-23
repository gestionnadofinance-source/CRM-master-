/**
 * Traduction française des codes d'action bruts stockés dans ActivityLog
 * (ex: "chantier.created"). Un seul point de vérité partagé par toutes les
 * vues qui affichent un fil d'activité (journal d'activité de l'espace et
 * de l'administration) afin qu'aucune ne laisse fuiter un code brut à
 * l'écran.
 */
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  "chantier.assignment_removed": "Affectation chantier retirée",
  "chantier.assignment_updated": "Affectation chantier modifiée",
  "chantier.created": "Chantier créé",
  "chantier.deleted": "Chantier supprimé",
  "chantier.updated": "Chantier modifié",
  "crm.created": "CRM créé",
  "crm.updated": "CRM modifié",
  "pointage.client_sheet_deposited": "Fiche de pointage client déposée",
  "pointage.employee_sheets_deposited": "Fiches de pointage salariés déposées",
  "pointage.employee_sheets_emailed": "Fiches de pointage envoyées par email",
  "pointage.entry_saved": "Pointage enregistré",
  "pointage.timesheet_document_deleted": "Document de pointage supprimé",
  "user.access_updated": "Accès utilisateur modifié",
  "user.activity_history_deleted": "Historique d'activité supprimé",
  "user.created": "Utilisateur créé",
  "user.disabled": "Utilisateur désactivé",
  "user.password_regenerated": "Mot de passe régénéré",
  "user.password_set": "Mot de passe défini",
  "user.reactivated": "Utilisateur réactivé",
  "vault.document_added": "Document déposé au coffre-fort",
  "vault.document_deleted": "Document du coffre-fort supprimé",
};

/** Traduit un code d'action ActivityLog ; retombe sur le code brut si jamais un nouveau type d'action n'a pas encore été ajouté ci-dessus. */
export function translateActivityAction(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action;
}
