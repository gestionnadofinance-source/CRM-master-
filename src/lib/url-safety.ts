import "server-only";

function isIpv4PrivateOrReserved(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 127) return true; // loopback
  if (a === 10) return true; // privé (RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true; // privé (RFC 1918)
  if (a === 192 && b === 168) return true; // privé (RFC 1918)
  if (a === 169 && b === 254) return true; // link-local, inclut le endpoint de métadonnées cloud 169.254.169.254
  if (a === 0) return true; // "this network"
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (RFC 6598)
  return false;
}

function isIpv6PrivateOrReserved(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local (ULA)
  return false;
}

/**
 * Refuse tout ce qui n'est pas une URL https publique classique. Utilisé
 * pour les champs fournis par un utilisateur du CRM et récupérés côté
 * serveur (logo affiché dans le PDF de devis, généré par
 * @react-pdf/renderer) : sans ce contrôle, un utilisateur pourrait faire
 * pointer le serveur vers une adresse interne (réseau privé, localhost,
 * endpoint de métadonnées cloud...) et en exfiltrer la réponse via le PDF
 * généré (SSRF aveugle). Ce contrôle porte sur la chaîne fournie, pas sur
 * l'IP effectivement résolue au moment de la requête — il bloque les cas
 * évidents (IP littérale privée/interne, localhost) mais ne protège pas
 * d'un nom de domaine public dont le DNS serait reconfiguré après coup
 * pour pointer vers une IP interne (DNS rebinding), risque résiduel accepté
 * ici en l'absence de proxy de sortie filtrant.
 */
export function isPubliclySafeHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (isIpv4PrivateOrReserved(hostname)) return false;
  if (hostname.includes(":") && isIpv6PrivateOrReserved(hostname)) return false;

  return true;
}
