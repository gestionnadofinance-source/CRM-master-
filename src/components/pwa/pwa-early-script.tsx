/**
 * Capture, dès le chargement de la page et avant même React, l'invite
 * d'installation native (beforeinstallprompt) : Chrome et Edge peuvent
 * l'émettre très tôt, et un écouteur posé plus tard la manquerait. L'invite
 * est mise de côté pour le bouton « Télécharger l'application » — elle n'est
 * JAMAIS affichée sans un clic de l'utilisateur.
 *
 * Aucune donnée personnelle n'est stockée : seulement le fait que
 * l'application a été installée sur cet appareil (localStorage).
 */
const SCRIPT = `
(function () {
  try {
    var s = (window.__crmPwa = window.__crmPwa || { prompt: null, installed: false });
    function changed() { window.dispatchEvent(new Event("crm-pwa-change")); }
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      s.prompt = e;
      try { localStorage.removeItem("crm-pwa-installed"); } catch (x) {}
      changed();
    });
    window.addEventListener("appinstalled", function () {
      s.prompt = null;
      s.installed = true;
      try { localStorage.setItem("crm-pwa-installed", "1"); } catch (x) {}
      changed();
    });
  } catch (e) {}
})();
`;

export function PwaEarlyScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
