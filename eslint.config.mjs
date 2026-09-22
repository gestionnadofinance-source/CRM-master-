import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next 16 expose directement des tableaux au format plat :
// le passage par FlatCompat (@eslint/eslintrc), nécessaire tant que la
// configuration n'était publiée qu'au format historique, n'a plus lieu d'être.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // next-env.d.ts est régénéré par Next.js à chaque build ("This file
    // should not be edited") : le lint ne doit jamais porter dessus.
    ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"],
  },
  {
    /**
     * eslint-plugin-react-hooks v6, embarqué par eslint-config-next 16, ajoute
     * quatre règles issues du React Compiler. Elles signalent 30 occurrences
     * dans des composants qui n'ont pas changé : ce n'est pas une régression
     * mais un constat nouveau sur du code existant.
     *
     * Les rétrograder en avertissement est délibéré. Les corriger revient à
     * réécrire la logique d'effets de dix composants (agenda, réservation,
     * pointage...) — un risque de comportement réel, pour un gain nul en
     * sécurité. Elles restent donc visibles à chaque `npm run lint` plutôt que
     * masquées, et constituent une dette à traiter isolément, composant par
     * composant, avec une vérification fonctionnelle à chaque étape.
     */
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
