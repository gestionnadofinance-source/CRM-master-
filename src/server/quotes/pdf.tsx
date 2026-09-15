import "server-only";
import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { QUOTE_STATUS_LABELS } from "@/server/quotes/status";
import { isPubliclySafeHttpsUrl } from "@/lib/url-safety";

// Désactive la recherche de polices distantes (Helvetica standard suffit et
// évite toute dépendance réseau lors du rendu côté serveur).
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1f2933",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  logo: { width: 120, maxHeight: 60, objectFit: "contain" },
  companyBlock: { maxWidth: 260 },
  companyName: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  smallLine: { fontSize: 8.5, color: "#52606d", lineHeight: 1.4 },
  metaBlock: { alignItems: "flex-end" },
  quoteTitle: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  metaLine: { fontSize: 9, color: "#334155", marginBottom: 2 },
  statusBadge: {
    marginTop: 4,
    fontSize: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    backgroundColor: "#eef2ff",
    color: "#3730a3",
  },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#8896a6",
    marginBottom: 4,
  },
  clientBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 10,
    maxWidth: 260,
  },
  clientName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  objectText: { fontSize: 10, fontWeight: 700, marginTop: 4 },
  table: { marginTop: 8, borderTopWidth: 1, borderTopColor: "#cbd5e1", borderTopStyle: "solid" },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  colDesignation: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1.3, textAlign: "right" },
  colVat: { flex: 1, textAlign: "right" },
  colTotal: { flex: 1.3, textAlign: "right" },
  tableHeaderText: { fontSize: 8, fontWeight: 700, color: "#475569", textTransform: "uppercase" },
  tableCellText: { fontSize: 9, color: "#1f2933" },
  totalsBlock: { marginTop: 12, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", width: 220, justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: "#52606d" },
  totalsValue: { fontSize: 9, color: "#1f2933" },
  totalsRowFinal: {
    flexDirection: "row",
    width: 220,
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    borderTopStyle: "solid",
  },
  totalsLabelFinal: { fontSize: 10, fontWeight: 700, color: "#1f2933" },
  totalsValueFinal: { fontSize: 11, fontWeight: 700, color: "#1f2933" },
  textBlock: { fontSize: 8.5, color: "#52606d", lineHeight: 1.5 },
  signatureBlock: { marginTop: 28, flexDirection: "row", justifyContent: "space-between" },
  signatureColumn: { maxWidth: 220 },
  signatureLabel: { fontSize: 8, color: "#8896a6", marginBottom: 6, textTransform: "uppercase" },
  signatureImage: { width: 140, maxHeight: 60, objectFit: "contain" },
  signatureText: { fontSize: 13, fontFamily: "Times-Italic", color: "#1f2933" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: "#94a3b8",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderTopStyle: "solid",
    paddingTop: 6,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    right: 40,
    fontSize: 7.5,
    color: "#94a3b8",
  },
});

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateFr(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function isAbsoluteUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

export interface QuotePdfItem {
  id: string;
  designation: string;
  quantity: number;
  unitPriceHt: number;
  vatRateLabel: string;
  vatRatePercent: number;
  totalHt: number;
}

export interface QuotePdfData {
  crmName: string;
  companySettings: {
    legalName: string;
    logoUrl: string | null;
    address: string;
    postalCode: string;
    city: string;
    siret: string;
    phone: string;
    email: string;
    website: string;
    legalMentions: string;
  } | null;
  template: { logoUrl: string | null; primaryColor: string } | null;
  number: string;
  status: string;
  issueDate: Date;
  validUntil: Date;
  object: string;
  conditions: string | null;
  mentions: string | null;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  currentVersion: number;
  client: {
    company: string;
    address: string | null;
    siret: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  commercial: {
    name: string;
    signatureText: string | null;
    signatureImageUrl: string | null;
  };
  items: QuotePdfItem[];
}

/** Charge toutes les données nécessaires au rendu PDF d'un devis. Ne fait AUCUNE vérification d'accès CRM : à l'appelant de l'avoir déjà validée. */
export async function loadQuotePdfData(quoteId: string): Promise<QuotePdfData | null> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      crm: { include: { companySettings: true, quoteTemplates: { where: { isDefault: true }, take: 1 } } },
      client: true,
      prospect: true,
      createdBy: { select: { firstName: true, lastName: true, signatureText: true, signatureImageUrl: true } },
      items: { orderBy: { order: "asc" }, include: { vatRate: true } },
    },
  });
  if (!quote) return null;

  // Un devis est rattaché à un client OU à un prospect : les deux modèles
  // exposent les mêmes champs pertinents pour le PDF (raison sociale,
  // adresse, SIRET, contact).
  const party = quote.client ?? quote.prospect;
  if (!party) return null;

  const template = quote.crm.quoteTemplates[0] ?? null;
  const settings = quote.crm.companySettings;

  return {
    crmName: quote.crm.name,
    companySettings: settings
      ? {
          legalName: settings.legalName,
          logoUrl: settings.logoUrl,
          address: settings.address,
          postalCode: settings.postalCode,
          city: settings.city,
          siret: settings.siret,
          phone: settings.phone,
          email: settings.email,
          website: settings.website,
          legalMentions: settings.legalMentions,
        }
      : null,
    template: template ? { logoUrl: template.logoUrl, primaryColor: template.primaryColor } : null,
    number: quote.number,
    status: quote.status,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    object: quote.object,
    conditions: quote.conditions,
    mentions: quote.mentions,
    totalHt: Number(quote.totalHt),
    totalVat: Number(quote.totalVat),
    totalTtc: Number(quote.totalTtc),
    currentVersion: quote.currentVersion,
    client: {
      company: party.company,
      address: party.address,
      siret: quote.siretSnapshot ?? party.siret,
      firstName: party.firstName,
      lastName: party.lastName,
      email: party.email,
      phone: party.phone,
    },
    commercial: {
      name: `${quote.createdBy.firstName} ${quote.createdBy.lastName}`,
      signatureText: quote.createdBy.signatureText,
      signatureImageUrl: quote.createdBy.signatureImageUrl,
    },
    items: quote.items.map((item) => {
      const quantity = Number(item.quantity);
      const unitPriceHt = Number(item.unitPriceHt);
      return {
        id: item.id,
        designation: item.designation,
        quantity,
        unitPriceHt,
        vatRateLabel: item.vatRate.label,
        vatRatePercent: Number(item.vatRate.rate),
        totalHt: quantity * unitPriceHt,
      };
    }),
  };
}

export function QuotePdfDocument({ data }: { data: QuotePdfData }) {
  // isPubliclySafeHttpsUrl (et non le simple isAbsoluteUrl utilisé pour la
  // signature ci-dessous) : ces deux champs sont modifiables par les
  // utilisateurs du CRM (paramètres entreprise / modèles de devis) — même
  // si la saisie est déjà validée à l'écriture, on revalide ici en défense
  // en profondeur pour couvrir toute valeur qui aurait été enregistrée
  // avant l'ajout de ce contrôle.
  const logoUrl = isPubliclySafeHttpsUrl(data.companySettings?.logoUrl ?? "")
    ? data.companySettings!.logoUrl!
    : isPubliclySafeHttpsUrl(data.template?.logoUrl ?? "")
      ? data.template!.logoUrl!
      : null;
  const legalName = data.companySettings?.legalName?.trim() || data.crmName;
  const addressLine = [data.companySettings?.address, [data.companySettings?.postalCode, data.companySettings?.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" — ");
  const clientAddress = data.client.address;
  const clientContactName = [data.client.firstName, data.client.lastName].filter(Boolean).join(" ");

  return (
    <Document title={`Devis ${data.number}`} author={legalName}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            {logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image (PDF canvas), not an HTML <img>
              <Image src={logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.companyName}>{legalName}</Text>
            )}
            {addressLine ? <Text style={styles.smallLine}>{addressLine}</Text> : null}
            {data.companySettings?.siret ? <Text style={styles.smallLine}>SIRET : {data.companySettings.siret}</Text> : null}
            {data.companySettings?.phone ? <Text style={styles.smallLine}>Tél. {data.companySettings.phone}</Text> : null}
            {data.companySettings?.email ? <Text style={styles.smallLine}>{data.companySettings.email}</Text> : null}
            {data.companySettings?.website ? <Text style={styles.smallLine}>{data.companySettings.website}</Text> : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.quoteTitle}>DEVIS {data.number}</Text>
            <Text style={styles.metaLine}>Date d&apos;émission : {formatDateFr(data.issueDate)}</Text>
            <Text style={styles.metaLine}>Valable jusqu&apos;au : {formatDateFr(data.validUntil)}</Text>
            {data.currentVersion > 1 ? <Text style={styles.metaLine}>Version {data.currentVersion}</Text> : null}
            <Text style={styles.statusBadge}>{QUOTE_STATUS_LABELS[data.status as keyof typeof QUOTE_STATUS_LABELS] ?? data.status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Adressé à</Text>
          <View style={styles.clientBox}>
            <Text style={styles.clientName}>{data.client.company}</Text>
            {clientContactName ? <Text style={styles.smallLine}>{clientContactName}</Text> : null}
            {clientAddress ? <Text style={styles.smallLine}>{clientAddress}</Text> : null}
            {data.client.siret ? <Text style={styles.smallLine}>SIRET : {data.client.siret}</Text> : null}
            {data.client.email ? <Text style={styles.smallLine}>{data.client.email}</Text> : null}
            {data.client.phone ? <Text style={styles.smallLine}>{data.client.phone}</Text> : null}
          </View>
          <Text style={styles.objectText}>Objet : {data.object}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow} fixed>
            <Text style={[styles.tableHeaderText, styles.colDesignation]}>Désignation</Text>
            <Text style={[styles.tableHeaderText, styles.colQty]}>Qté</Text>
            <Text style={[styles.tableHeaderText, styles.colUnit]}>PU HT</Text>
            <Text style={[styles.tableHeaderText, styles.colVat]}>TVA</Text>
            <Text style={[styles.tableHeaderText, styles.colTotal]}>Total HT</Text>
          </View>
          {data.items.map((item) => (
            <View style={styles.tableRow} key={item.id} wrap={false}>
              <Text style={[styles.tableCellText, styles.colDesignation]}>{item.designation}</Text>
              <Text style={[styles.tableCellText, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.tableCellText, styles.colUnit]}>{formatEur(item.unitPriceHt)}</Text>
              <Text style={[styles.tableCellText, styles.colVat]}>{item.vatRatePercent}%</Text>
              <Text style={[styles.tableCellText, styles.colTotal]}>{formatEur(item.totalHt)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total HT</Text>
            <Text style={styles.totalsValue}>{formatEur(data.totalHt)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total TVA</Text>
            <Text style={styles.totalsValue}>{formatEur(data.totalVat)}</Text>
          </View>
          <View style={styles.totalsRowFinal}>
            <Text style={styles.totalsLabelFinal}>Total TTC</Text>
            <Text style={styles.totalsValueFinal}>{formatEur(data.totalTtc)}</Text>
          </View>
        </View>

        {data.conditions ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Conditions</Text>
            <Text style={styles.textBlock}>{data.conditions}</Text>
          </View>
        ) : null}

        {data.mentions ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Mentions</Text>
            <Text style={styles.textBlock}>{data.mentions}</Text>
          </View>
        ) : null}

        <View style={styles.signatureBlock} wrap={false}>
          <View />
          <View style={styles.signatureColumn}>
            <Text style={styles.signatureLabel}>Bon pour accord — {data.commercial.name}</Text>
            {isAbsoluteUrl(data.commercial.signatureImageUrl) ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image (PDF canvas), not an HTML <img>
              <Image src={data.commercial.signatureImageUrl} style={styles.signatureImage} />
            ) : data.commercial.signatureText ? (
              <Text style={styles.signatureText}>{data.commercial.signatureText}</Text>
            ) : (
              <Text style={styles.smallLine}>{data.commercial.name}</Text>
            )}
          </View>
        </View>

        {data.companySettings?.legalMentions ? (
          <Text style={styles.footer} fixed>
            {data.companySettings.legalMentions}
          </Text>
        ) : null}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function renderQuotePdfBuffer(quoteId: string): Promise<{ buffer: Buffer; fileName: string; quoteNumber: string } | null> {
  const data = await loadQuotePdfData(quoteId);
  if (!data) return null;
  const buffer = await renderToBuffer(<QuotePdfDocument data={data} />);
  return { buffer, fileName: `devis-${data.number}.pdf`, quoteNumber: data.number };
}
