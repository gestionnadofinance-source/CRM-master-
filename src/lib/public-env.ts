// Fichier volontairement séparé de lib/env.ts : celui-ci ne doit exposer
// que des variables NEXT_PUBLIC_* et rester importable depuis le client.
export const publicEnv = {
  pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY ?? "",
  pusherCluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "",
};
