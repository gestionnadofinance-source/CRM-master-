import "server-only";
import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import {
  DAY_LABELS,
  computePointageTotals,
  activeIndemnityKeys,
  activePrimeLines,
  type PointageDay,
  type PointageRates,
  type PointagePrimes,
  type ChantierFixedAmounts,
  type AssignmentTravelRates,
  type PointageAppliedFlags,
} from "@/server/pointage/calc";

Font.registerHyphenationCallback((word) => [word]);

function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatHours(n: number): string {
  return n === 0 ? "" : n % 1 === 0 ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Feuille de pointage SALARIÉ — une fiche par employé et par semaine.
// ---------------------------------------------------------------------------

const empStyles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1f2933" },
  title: { fontSize: 13, fontWeight: 700, textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 9, textAlign: "center", color: "#52606d", marginBottom: 14 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  metaLabel: { fontSize: 9, color: "#52606d" },
  metaValue: { fontSize: 9, fontWeight: 700 },
  table: { marginTop: 12, borderWidth: 1, borderColor: "#94a3b8", borderStyle: "solid" },
  row: { flexDirection: "row" },
  headerCell: {
    fontSize: 7.5,
    fontWeight: 700,
    textAlign: "center",
    padding: 4,
    backgroundColor: "#f1f5f9",
    borderRightWidth: 1,
    borderRightColor: "#cbd5e1",
    borderRightStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    borderBottomStyle: "solid",
  },
  cell: {
    fontSize: 8.5,
    textAlign: "center",
    padding: 4,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  dayCell: { flex: 1.4, textAlign: "left" },
  numCell: { flex: 1 },
  totalRow: { backgroundColor: "#f8fafc" },
  summaryBlock: { marginTop: 16, flexDirection: "row", gap: 24 },
  summaryCol: { flex: 1 },
  summaryTitle: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#8896a6", marginBottom: 6 },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", fontSize: 9, marginBottom: 3 },
  summaryLineFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 10,
    fontWeight: 700,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    borderTopStyle: "solid",
  },
  comments: { marginTop: 16, borderWidth: 1, borderColor: "#e2e8f0", borderStyle: "solid", borderRadius: 3, padding: 8, minHeight: 40 },
  commentsLabel: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#8896a6", marginBottom: 4 },
  signatureBlock: { marginTop: 24, flexDirection: "row", justifyContent: "space-between" },
  signatureCol: { width: 200, borderTopWidth: 1, borderTopColor: "#94a3b8", borderTopStyle: "solid", paddingTop: 4 },
  signatureLabel: { fontSize: 8, color: "#52606d" },
});

export interface EmployeeTimesheetData {
  crmName: string;
  chantierName: string;
  chantierAddress: string | null;
  employeeName: string;
  foremanName: string;
  weekStart: Date;
  weekEnd: Date;
  weekNumber: number;
  days: PointageDay[];
  rates: PointageRates;
  primes: PointagePrimes;
  chantierAmounts: ChantierFixedAmounts;
  assignmentRates: AssignmentTravelRates;
  applied: PointageAppliedFlags;
  comments: string | null;
}

const PRIME_LABELS: Record<
  "housingAllowance" | "dirtAllowance" | "managementBonus" | "zoneBonus" | "maskBonus" | "postBonus" | "clothingBonus",
  string
> = {
  housingAllowance: "Prime logement",
  dirtAllowance: "Prime salissure",
  managementBonus: "Prime management",
  zoneBonus: "Prime de zone",
  maskBonus: "Prime de masque",
  postBonus: "Prime de poste",
  clothingBonus: "Prime habillage",
};

export function EmployeeTimesheetPdfDocument({ data }: { data: EmployeeTimesheetData }) {
  const totals = computePointageTotals(data.days, data.rates, data.primes, data.chantierAmounts, data.assignmentRates, data.applied);
  const indemnityKeys = activeIndemnityKeys(totals);
  const primeLines = activePrimeLines(data.primes, totals);
  return (
    <Document title={`Pointage ${data.employeeName} S${data.weekNumber}`} author={data.crmName}>
      <Page size="A4" style={empStyles.page}>
        <Text style={empStyles.title}>FEUILLE DE POINTAGE — {data.crmName.toUpperCase()}</Text>
        <Text style={empStyles.subtitle}>Semaine {data.weekNumber} · du {formatDateFr(data.weekStart)} au {formatDateFr(data.weekEnd)}</Text>

        <View style={empStyles.metaRow}>
          <Text style={empStyles.metaLabel}>Salarié</Text>
          <Text style={empStyles.metaValue}>{data.employeeName}</Text>
        </View>
        <View style={empStyles.metaRow}>
          <Text style={empStyles.metaLabel}>Chantier</Text>
          <Text style={empStyles.metaValue}>{data.chantierName}</Text>
        </View>
        {data.chantierAddress ? (
          <View style={empStyles.metaRow}>
            <Text style={empStyles.metaLabel}>Site</Text>
            <Text style={empStyles.metaValue}>{data.chantierAddress}</Text>
          </View>
        ) : null}

        <View style={empStyles.table}>
          <View style={empStyles.row} fixed>
            <Text style={[empStyles.headerCell, empStyles.dayCell]}>Jour</Text>
            <Text style={[empStyles.headerCell, empStyles.numCell]}>Normal</Text>
            <Text style={[empStyles.headerCell, empStyles.numCell]}>Matin</Text>
            <Text style={[empStyles.headerCell, empStyles.numCell]}>Après-midi</Text>
            <Text style={[empStyles.headerCell, empStyles.numCell]}>Nuit</Text>
          </View>
          {data.days.map((d, i) => (
            <View style={empStyles.row} key={d.date}>
              <Text style={[empStyles.cell, empStyles.dayCell]}>
                {DAY_LABELS[i]} {formatDateFr(new Date(d.date))}
              </Text>
              <Text style={[empStyles.cell, empStyles.numCell]}>{formatHours(d.normal)}</Text>
              <Text style={[empStyles.cell, empStyles.numCell]}>{formatHours(d.matin)}</Text>
              <Text style={[empStyles.cell, empStyles.numCell]}>{formatHours(d.apresMidi)}</Text>
              <Text style={[empStyles.cell, empStyles.numCell]}>{formatHours(d.nuit)}</Text>
            </View>
          ))}
          <View style={[empStyles.row, empStyles.totalRow]}>
            <Text style={[empStyles.cell, empStyles.dayCell, { fontWeight: 700 }]}>Total</Text>
            <Text style={[empStyles.cell, empStyles.numCell, { fontWeight: 700 }]}>{formatHours(totals.totalNormal)}</Text>
            <Text style={[empStyles.cell, empStyles.numCell, { fontWeight: 700 }]}>{formatHours(totals.totalMatin)}</Text>
            <Text style={[empStyles.cell, empStyles.numCell, { fontWeight: 700 }]}>{formatHours(totals.totalApresMidi)}</Text>
            <Text style={[empStyles.cell, empStyles.numCell, { fontWeight: 700 }]}>{formatHours(totals.totalNuit)}</Text>
          </View>
        </View>

        <View style={empStyles.summaryBlock}>
          <View style={empStyles.summaryCol}>
            <Text style={empStyles.summaryTitle}>Indemnités ({totals.daysWorked} jour{totals.daysWorked > 1 ? "s" : ""} travaillé{totals.daysWorked > 1 ? "s" : ""})</Text>
            {indemnityKeys.length === 0 && <Text style={{ color: "#8896a6" }}>Aucune</Text>}
            {indemnityKeys.includes("night") && (
              <View style={empStyles.summaryLine}>
                <Text>
                  Heures de nuit ({formatHours(totals.totalNuit)} h × {formatEur(data.rates.hourlyRate)} × {data.rates.nightRatePercent}%)
                </Text>
                <Text>{formatEur(totals.nightBonusAmount)}</Text>
              </View>
            )}
            {indemnityKeys.includes("lunch") && (
              <View style={empStyles.summaryLine}>
                <Text>Repas midi</Text>
                <Text>{formatEur(totals.lunchTotal)}</Text>
              </View>
            )}
            {indemnityKeys.includes("dinner") && (
              <View style={empStyles.summaryLine}>
                <Text>Repas soir</Text>
                <Text>{formatEur(totals.dinnerTotal)}</Text>
              </View>
            )}
            {indemnityKeys.includes("travel") && (
              <View style={empStyles.summaryLine}>
                <Text>Déplacement (GD)</Text>
                <Text>{formatEur(totals.travelTotal)}</Text>
              </View>
            )}
            {indemnityKeys.includes("km") && (
              <View style={empStyles.summaryLine}>
                <Text>
                  Frais kilométriques ({data.assignmentRates.distanceKm} km × {formatEur(data.assignmentRates.kmRate)})
                </Text>
                <Text>{formatEur(totals.kmTotal)}</Text>
              </View>
            )}
            {indemnityKeys.includes("travelHours") && (
              <View style={empStyles.summaryLine}>
                <Text>
                  Heures de trajet ({data.assignmentRates.travelDurationHours} h × {formatEur(data.assignmentRates.travelHourlyRate)})
                </Text>
                <Text>{formatEur(totals.travelHoursTotal)}</Text>
              </View>
            )}
            {indemnityKeys.includes("meal") && (
              <View style={empStyles.summaryLine}>
                <Text>Repas ({formatEur(data.chantierAmounts.mealAllowance)}/jour)</Text>
                <Text>{formatEur(totals.mealTotal)}</Text>
              </View>
            )}
          </View>
          <View style={empStyles.summaryCol}>
            <Text style={empStyles.summaryTitle}>Primes</Text>
            {primeLines.length === 0 && <Text style={{ color: "#8896a6" }}>Aucune</Text>}
            {primeLines.map((line) => (
              <View style={empStyles.summaryLine} key={line.key}>
                <Text>{PRIME_LABELS[line.key]}</Text>
                <Text>{formatEur(line.amount)}</Text>
              </View>
            ))}
            <View style={empStyles.summaryLineFinal}>
              <Text>Total frais de la semaine</Text>
              <Text>{formatEur(totals.grandTotal)}</Text>
            </View>
          </View>
        </View>

        {data.comments ? (
          <View style={empStyles.comments}>
            <Text style={empStyles.commentsLabel}>Commentaires travaux</Text>
            <Text>{data.comments}</Text>
          </View>
        ) : null}

        <View style={empStyles.signatureBlock}>
          <View style={empStyles.signatureCol}>
            <Text style={empStyles.signatureLabel}>Nom de l&apos;intervenant : {data.employeeName}</Text>
          </View>
          <View style={empStyles.signatureCol}>
            <Text style={empStyles.signatureLabel}>Nom du responsable : {data.foremanName}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderEmployeeTimesheetPdf(data: EmployeeTimesheetData): Promise<Buffer> {
  return renderToBuffer(<EmployeeTimesheetPdfDocument data={data} />);
}

// ---------------------------------------------------------------------------
// Feuille de pointage CLIENT — récapitulatif hebdomadaire par chantier,
// agrégeant tous les salariés pointés, pour visa du client.
// ---------------------------------------------------------------------------

const cliStyles = StyleSheet.create({
  page: { padding: 24, fontSize: 7, fontFamily: "Helvetica", color: "#1f2933" },
  title: { fontSize: 12, fontWeight: 700, textAlign: "center", marginBottom: 2 },
  subtitle: { fontSize: 8, textAlign: "center", color: "#52606d", marginBottom: 10 },
  table: { borderWidth: 1, borderColor: "#94a3b8", borderStyle: "solid" },
  row: { flexDirection: "row" },
  headerCell: {
    fontSize: 6,
    fontWeight: 700,
    textAlign: "center",
    padding: 2,
    backgroundColor: "#f1f5f9",
    borderRightWidth: 1,
    borderRightColor: "#cbd5e1",
    borderRightStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    borderBottomStyle: "solid",
  },
  dayGroupCell: {
    fontSize: 6.5,
    fontWeight: 700,
    textAlign: "center",
    padding: 2,
    backgroundColor: "#e2e8f0",
    borderRightWidth: 1,
    borderRightColor: "#94a3b8",
    borderRightStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    borderBottomStyle: "solid",
  },
  cell: {
    fontSize: 6.5,
    textAlign: "center",
    padding: 2,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  nameCell: { flex: 2.4, textAlign: "left" },
  dayCell: { flex: 1 },
  totalCell: { flex: 1.1 },
  totalRow: { backgroundColor: "#f8fafc" },
  signatureBlock: { marginTop: 20, flexDirection: "row", justifyContent: "space-between" },
  signatureCol: { width: 220, borderTopWidth: 1, borderTopColor: "#94a3b8", borderTopStyle: "solid", paddingTop: 4 },
  signatureLabel: { fontSize: 8, color: "#52606d" },
});

export interface ClientTimesheetRow {
  employeeName: string;
  days: PointageDay[];
}

export interface ClientTimesheetData {
  crmName: string;
  chantierName: string;
  weekStart: Date;
  weekEnd: Date;
  weekNumber: number;
  foremanName: string;
  rows: ClientTimesheetRow[];
}

function rowTotal(days: PointageDay[]): number {
  return days.reduce((s, d) => s + (d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0) + (d.nuit || 0), 0);
}

export function ClientTimesheetPdfDocument({ data }: { data: ClientTimesheetData }) {
  return (
    <Document title={`Pointage client ${data.chantierName} S${data.weekNumber}`} author={data.crmName}>
      <Page size="A4" orientation="landscape" style={cliStyles.page}>
        <Text style={cliStyles.title}>FEUILLE DE POINTAGE HEBDOMADAIRE — {data.chantierName}</Text>
        <Text style={cliStyles.subtitle}>
          {data.crmName} · Semaine {data.weekNumber} · du {formatDateFr(data.weekStart)} au {formatDateFr(data.weekEnd)}
        </Text>

        <View style={cliStyles.table}>
          <View style={cliStyles.row} fixed>
            <Text style={[cliStyles.headerCell, cliStyles.nameCell]}>Nom / Prénom</Text>
            {DAY_LABELS.map((label) => (
              <Text key={label} style={[cliStyles.dayGroupCell, cliStyles.dayCell]}>
                {label}
              </Text>
            ))}
            <Text style={[cliStyles.headerCell, cliStyles.totalCell]}>Total</Text>
          </View>
          {data.rows.map((r) => (
            <View style={cliStyles.row} key={r.employeeName}>
              <Text style={[cliStyles.cell, cliStyles.nameCell]}>{r.employeeName}</Text>
              {r.days.map((d) => {
                const t = (d.normal || 0) + (d.matin || 0) + (d.apresMidi || 0) + (d.nuit || 0);
                return (
                  <Text key={d.date} style={[cliStyles.cell, cliStyles.dayCell]}>
                    {formatHours(t)}
                  </Text>
                );
              })}
              <Text style={[cliStyles.cell, cliStyles.totalCell, { fontWeight: 700 }]}>{formatHours(rowTotal(r.days))}</Text>
            </View>
          ))}
          <View style={[cliStyles.row, cliStyles.totalRow]}>
            <Text style={[cliStyles.cell, cliStyles.nameCell, { fontWeight: 700 }]}>Total</Text>
            {DAY_LABELS.map((label, i) => {
              const total = data.rows.reduce((s, r) => {
                const d = r.days[i];
                return s + ((d?.normal || 0) + (d?.matin || 0) + (d?.apresMidi || 0) + (d?.nuit || 0));
              }, 0);
              return (
                <Text key={label} style={[cliStyles.cell, cliStyles.dayCell, { fontWeight: 700 }]}>
                  {formatHours(total)}
                </Text>
              );
            })}
            <Text style={[cliStyles.cell, cliStyles.totalCell, { fontWeight: 700 }]}>
              {formatHours(data.rows.reduce((s, r) => s + rowTotal(r.days), 0))}
            </Text>
          </View>
        </View>

        <View style={cliStyles.signatureBlock}>
          <View style={cliStyles.signatureCol}>
            <Text style={cliStyles.signatureLabel}>Chef de chantier {data.crmName} : {data.foremanName}</Text>
          </View>
          <View style={cliStyles.signatureCol}>
            <Text style={cliStyles.signatureLabel}>Visa client :</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderClientTimesheetPdf(data: ClientTimesheetData): Promise<Buffer> {
  return renderToBuffer(<ClientTimesheetPdfDocument data={data} />);
}
