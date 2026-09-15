import "server-only";
import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word) => [word]);

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatTimeFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

const DEFAULT_LEGAL_MENTIONS =
  "Véhicule personnel obligatoire. Sans justificatif de péage, les frais kilométriques ne seront pas remboursés. " +
  "Frais non pris en charge : téléphone personnel, bar, dépenses personnelles. Tous les frais sont remboursables " +
  "aux salariés sur justificatifs, non réglés directement aux fournisseurs.";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1f2933" },
  title: { fontSize: 13, fontWeight: 700, textAlign: "center", marginBottom: 14 },
  columns: { flexDirection: "row", gap: 24, marginBottom: 14 },
  col: { flex: 1 },
  blockTitle: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#8896a6", marginBottom: 4 },
  line: { fontSize: 9, marginBottom: 2 },
  section: { marginTop: 10, borderTopWidth: 1, borderTopColor: "#e2e8f0", borderTopStyle: "solid", paddingTop: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  rowLabel: { fontSize: 9, color: "#52606d" },
  rowValue: { fontSize: 9, fontWeight: 700, textAlign: "right", maxWidth: "65%" },
  legal: { marginTop: 12, fontSize: 7.5, color: "#8896a6", lineHeight: 1.4 },
  signatureBlock: { marginTop: 24, flexDirection: "row", justifyContent: "space-between" },
  signatureCol: { width: 220 },
  signatureLabel: { fontSize: 9, marginBottom: 24 },
  signatureLine: { borderTopWidth: 1, borderTopColor: "#94a3b8", borderTopStyle: "solid", paddingTop: 4 },
  footer: { marginTop: 20, fontSize: 8, color: "#8896a6", textAlign: "center" },
});

export interface MissionOrderPdfData {
  company: {
    legalName: string;
    address: string;
    postalCode: string;
    city: string;
    siret: string;
    ape: string;
    urssafOffice: string;
    legalRepresentative: string;
    legalMentions: string;
    phone: string;
    email: string;
  };
  employeeName: string;
  employeeAddress: string | null;
  missionNature: string | null;
  clientName: string | null;
  siteAddress: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  importantDocuments: string | null;
  travelDate: Date | null;
  travelDurationHours: number;
  travelAllowanceAmount: number;
  distanceKm: number;
  kmRate: number;
  kmAmount: number;
  generatedAt: Date;
}

export function MissionOrderPdfDocument({ data }: { data: MissionOrderPdfData }) {
  const addressLine = [data.company.address, [data.company.postalCode, data.company.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <Document title={`Ordre de mission — ${data.employeeName}`} author={data.company.legalName}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>ORDRE DE MISSION</Text>

        <View style={styles.columns}>
          <View style={styles.col}>
            <Text style={styles.blockTitle}>Employeur</Text>
            <Text style={[styles.line, { fontWeight: 700 }]}>{data.company.legalName}</Text>
            {addressLine ? <Text style={styles.line}>{addressLine}</Text> : null}
            {data.company.urssafOffice ? <Text style={styles.line}>Relevant de l&apos;{data.company.urssafOffice}</Text> : null}
            {data.company.legalRepresentative ? <Text style={styles.line}>Représenté par {data.company.legalRepresentative}</Text> : null}
            {data.company.siret ? <Text style={styles.line}>SIRET : {data.company.siret}</Text> : null}
            {data.company.ape ? <Text style={styles.line}>APE : {data.company.ape}</Text> : null}
          </View>
          <View style={styles.col}>
            <Text style={styles.blockTitle}>Salarié</Text>
            <Text style={[styles.line, { fontWeight: 700 }]}>{data.employeeName}</Text>
            {data.employeeAddress ? <Text style={styles.line}>{data.employeeAddress}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.blockTitle}>Mission</Text>
          {data.missionNature ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Nature de la mission</Text>
              <Text style={styles.rowValue}>{data.missionNature}</Text>
            </View>
          ) : null}
          {data.clientName ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Client</Text>
              <Text style={styles.rowValue}>{data.clientName}</Text>
            </View>
          ) : null}
          {data.siteAddress ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Adresse du site</Text>
              <Text style={styles.rowValue}>{data.siteAddress}</Text>
            </View>
          ) : null}
          {data.travelDate ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Voyage</Text>
              <Text style={styles.rowValue}>{formatDateFr(data.travelDate)}</Text>
            </View>
          ) : null}
          {data.travelDate ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Prise de poste</Text>
              <Text style={styles.rowValue}>
                {formatDateFr(data.travelDate)} à {formatTimeFr(data.travelDate)}
              </Text>
            </View>
          ) : null}
          {data.travelDurationHours > 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Trajet</Text>
              <Text style={styles.rowValue}>{data.travelDurationHours} h</Text>
            </View>
          ) : null}
          {data.siteContactName || data.siteContactPhone ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Contact sur site</Text>
              <Text style={styles.rowValue}>{[data.siteContactName, data.siteContactPhone].filter(Boolean).join(" ")}</Text>
            </View>
          ) : null}
        </View>

        {data.importantDocuments ? (
          <View style={styles.section}>
            <Text style={styles.blockTitle}>Documents importants pour le chantier</Text>
            <Text style={styles.line}>{data.importantDocuments}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.blockTitle}>Indemnités</Text>
          {data.travelAllowanceAmount > 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Indemnité journalière (grand déplacement)</Text>
              <Text style={styles.rowValue}>{formatEur(data.travelAllowanceAmount)} par jour travaillé</Text>
            </View>
          ) : null}
          {data.kmAmount > 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Indemnités kilométriques</Text>
              <Text style={styles.rowValue}>
                {formatEur(data.kmAmount)} (KM {data.distanceKm} TAUX : {data.kmRate})
              </Text>
            </View>
          ) : null}
          {data.travelAllowanceAmount === 0 && data.kmAmount === 0 ? <Text style={{ color: "#8896a6" }}>Aucune</Text> : null}
        </View>

        <Text style={styles.legal}>{data.company.legalMentions || DEFAULT_LEGAL_MENTIONS}</Text>

        <View style={styles.signatureBlock}>
          <View style={styles.signatureCol}>
            <Text style={styles.signatureLabel}>
              Fait à {data.company.city || "—"}, le {formatDateFr(data.generatedAt)}
            </Text>
            <Text style={styles.signatureLine}>Salarié : {data.employeeName} — Signature</Text>
          </View>
        </View>

        {data.company.phone || data.company.email ? (
          <Text style={styles.footer}>
            Pour toute demande d&apos;information : {[data.company.phone, data.company.email].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

export async function renderMissionOrderPdf(data: MissionOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<MissionOrderPdfDocument data={data} />);
}
