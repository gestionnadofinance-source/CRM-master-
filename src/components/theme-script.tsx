const THEME_SCRIPT = `
(function () {
  try {
    var stored = document.cookie.match(/(?:^|; )theme=([^;]+)/);
    var pref = stored ? decodeURIComponent(stored[1]) : "system";
    var isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
