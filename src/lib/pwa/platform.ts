/**
 * Détection de l'appareil et du navigateur, et instructions d'installation
 * adaptées, pour le bouton « Télécharger l'application ».
 *
 * Seuls Chrome, Edge et les navigateurs Chromium proposent une installation
 * déclenchable par la page (événement beforeinstallprompt). Partout ailleurs
 * — Safari sur iPhone, iPad et Mac, Firefox, Samsung Internet… — l'installation
 * passe par un menu du navigateur : on l'explique, sans jamais prétendre
 * l'avoir déclenchée.
 *
 * Module pur (aucun accès au navigateur ici) : testé dans
 * tests/pwa-platform.test.ts.
 */

export type Os = "ios" | "android" | "windows" | "macos" | "linux" | "other";
export type Browser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "opera" | "inapp" | "other";

export interface Platform {
  os: Os;
  browser: Browser;
  /** Version majeure d'iOS / iPadOS, quand elle est lisible. */
  iosVersion: number | null;
  /** iPad se présentant comme un Mac (iPadOS 13 et suivants). */
  isIpad: boolean;
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = userAgent;
  const isIpadAsMac = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const isIos = /iPhone|iPad|iPod/.test(ua) || isIpadAsMac;
  const os: Os = isIos
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : /Windows/.test(ua)
        ? "windows"
        : /Macintosh|Mac OS X/.test(ua)
          ? "macos"
          : /Linux|CrOS/.test(ua)
            ? "linux"
            : "other";

  const iosMatch = /OS (\d+)[_.]\d/.exec(ua);
  // Safari 26 sur iOS 26 annonce encore « OS 18_6 » : la version de Safari
  // (« Version/26 ») est alors la plus fiable.
  const safariVersion = /Version\/(\d+)/.exec(ua);
  const iosVersion = isIos
    ? Math.max(iosMatch ? Number(iosMatch[1]) : 0, safariVersion ? Number(safariVersion[1]) : 0) || null
    : null;

  // Navigateurs intégrés aux applications (Facebook, Instagram, LinkedIn,
  // Gmail, WhatsApp…) : ils n'installent pas d'application web.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Snapchat|musical_ly|TikTok|Twitter|WhatsApp|GSA\/|Pinterest|; wv\)/.test(ua);

  let browser: Browser;
  if (inApp) browser = "inapp";
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = "edge";
  else if (/SamsungBrowser/.test(ua)) browser = "samsung";
  else if (/OPR\/|OPiOS|Opera/.test(ua)) browser = "opera";
  else if (/FxiOS|Firefox\//.test(ua)) browser = "firefox";
  else if (/CriOS|Chrome\/|Chromium\//.test(ua)) browser = "chrome";
  else if (/Safari\//.test(ua)) browser = "safari";
  else browser = "other";

  return { os, browser, iosVersion, isIpad: isIpadAsMac || /iPad/.test(ua) };
}

export interface InstallHelp {
  title: string;
  steps: string[];
  /** Précision affichée sous les étapes (limite, alternative). */
  note?: string;
  /** false : ce navigateur ne sait pas installer d'application web. */
  supported: boolean;
}

/** Instructions manuelles, quand l'invite d'installation native n'est pas disponible. */
export function installHelp(p: Platform): InstallHelp {
  if (p.os === "ios") {
    const appareil = p.isIpad ? "l'iPad" : "l'iPhone";
    if (p.browser === "inapp") {
      return {
        supported: false,
        title: "Ouvrez d'abord la page dans Safari",
        steps: [
          "Touchez le menu de cette application (souvent « ••• » ou l'icône de partage).",
          "Choisissez « Ouvrir dans Safari » (ou « Ouvrir dans le navigateur »).",
          "Dans Safari, touchez de nouveau « Télécharger l'application ».",
        ],
        note: `Le navigateur intégré à cette application ne permet pas d'ajouter CRM Master sur l'écran d'accueil de ${appareil}.`,
      };
    }
    const partage =
      (p.iosVersion ?? 0) >= 26
        ? "Touchez « ••• » en bas de l'écran, puis « Partager »."
        : p.isIpad
          ? "Touchez le bouton Partager (carré avec une flèche vers le haut), en haut à droite."
          : "Touchez le bouton Partager (carré avec une flèche vers le haut), en bas de l'écran.";
    if (p.browser !== "safari" && (p.iosVersion ?? 0) < 16) {
      return {
        supported: false,
        title: "Ouvrez la page dans Safari",
        steps: [
          "Copiez l'adresse de cette page.",
          "Ouvrez-la dans Safari.",
          "Touchez de nouveau « Télécharger l'application ».",
        ],
        note: "Sur cette version d'iOS, seul Safari peut ajouter une application web à l'écran d'accueil.",
      };
    }
    return {
      supported: true,
      title: `Installer CRM Master sur ${appareil}`,
      steps: [
        p.browser === "safari"
          ? "Gardez cette page ouverte dans Safari."
          : "Dans ce navigateur, ouvrez le menu de partage de la page.",
        partage,
        "Faites défiler et choisissez « Sur l'écran d'accueil ».",
        "Vérifiez que « Ouvrir en tant qu'app web » est activé s'il est proposé, puis touchez « Ajouter ».",
      ],
      note: "iOS ne permet pas à un site de lancer lui-même l'installation : l'ajout se fait par ces quelques gestes. L'icône CRM Master apparaît ensuite sur l'écran d'accueil.",
    };
  }

  if (p.os === "android") {
    if (p.browser === "inapp") {
      return {
        supported: false,
        title: "Ouvrez d'abord la page dans Chrome",
        steps: [
          "Touchez le menu « ⋮ » de cette application.",
          "Choisissez « Ouvrir dans Chrome » (ou « Ouvrir dans le navigateur »).",
          "Dans Chrome, touchez de nouveau « Télécharger l'application ».",
        ],
        note: "Le navigateur intégré à cette application ne permet pas d'installer CRM Master.",
      };
    }
    if (p.browser === "samsung") {
      return {
        supported: true,
        title: "Installer CRM Master avec Samsung Internet",
        steps: [
          "Touchez l'icône d'installation dans la barre d'adresse, si elle apparaît.",
          "Sinon, touchez le menu « ≡ » en bas de l'écran.",
          "Choisissez « Ajouter la page à », puis « Écran d'accueil ».",
        ],
      };
    }
    if (p.browser === "firefox") {
      return {
        supported: true,
        title: "Installer CRM Master avec Firefox",
        steps: ["Touchez le menu « ⋮ ».", "Choisissez « Installer » ou « Ajouter à l'écran d'accueil ».", "Confirmez."],
      };
    }
    return {
      supported: true,
      title: "Installer CRM Master sur Android",
      steps: [
        "Touchez le menu « ⋮ » en haut à droite du navigateur.",
        "Choisissez « Installer l'application » (ou « Ajouter à l'écran d'accueil », puis « Installer »).",
        "Confirmez : l'icône CRM Master apparaît sur l'écran d'accueil et dans la liste des applications.",
      ],
    };
  }

  // Ordinateurs.
  if (p.browser === "safari" && p.os === "macos") {
    return {
      supported: true,
      title: "Installer CRM Master sur le Mac (Safari)",
      steps: [
        "Dans la barre de menus, ouvrez « Fichier ».",
        "Choisissez « Ajouter au Dock… ».",
        "Confirmez avec « Ajouter » : CRM Master apparaît dans le Dock et dans le dossier Applications.",
      ],
      note: "Nécessite macOS Sonoma (14) ou plus récent. Sur une version plus ancienne, utilisez Chrome ou Edge.",
    };
  }
  if (p.browser === "edge") {
    return {
      supported: true,
      title: "Installer CRM Master avec Microsoft Edge",
      steps: [
        "Cliquez sur l'icône d'installation à droite de la barre d'adresse, si elle apparaît.",
        "Sinon, ouvrez le menu « … » en haut à droite.",
        "Choisissez « Applications », puis « Installer ce site en tant qu'application ».",
      ],
    };
  }
  if (p.browser === "chrome" || p.browser === "opera") {
    return {
      supported: true,
      title: "Installer CRM Master avec Chrome",
      steps: [
        "Cliquez sur l'icône d'installation (écran avec une flèche) à droite de la barre d'adresse, si elle apparaît.",
        "Sinon, ouvrez le menu « ⋮ » en haut à droite.",
        "Choisissez « Caster, enregistrer et partager », puis « Installer la page en tant qu'application… ».",
      ],
      note: "Si l'option n'apparaît pas, l'application est peut-être déjà installée : cherchez « CRM Master » dans le menu Démarrer, le Launchpad ou vos applications.",
    };
  }
  if (p.browser === "firefox") {
    return {
      supported: false,
      title: "Firefox n'installe pas les applications web",
      steps: [
        "Ouvrez l'adresse de CRM Master dans Google Chrome ou Microsoft Edge.",
        "Cliquez sur « Télécharger l'application » dans le menu de votre compte.",
      ],
      note: "Vous pouvez continuer à utiliser CRM Master normalement dans Firefox.",
    };
  }
  return {
    supported: false,
    title: "Installation non prise en charge par ce navigateur",
    steps: [
      "Ouvrez l'adresse de CRM Master dans Google Chrome, Microsoft Edge ou, sur Mac et iPhone, dans Safari.",
      "Cliquez sur « Télécharger l'application » dans le menu de votre compte.",
    ],
    note: "Vous pouvez continuer à utiliser CRM Master normalement dans ce navigateur.",
  };
}

/** Faut-il proposer l'installation (bandeau) sur cet appareil, sans invite native disponible ? */
export function canProposeManualInstall(p: Platform): boolean {
  if (p.os === "ios") return true; // y compris pour expliquer comment ouvrir dans Safari
  if (p.os === "macos" && p.browser === "safari") return true;
  if (p.os === "android" && (p.browser === "samsung" || p.browser === "firefox" || p.browser === "inapp")) return true;
  return false;
}
