"use client";

import { useEffect, useRef, useState } from "react";
import type Pusher from "pusher-js";
import { publicEnv } from "@/lib/public-env";

type PusherInstance = InstanceType<typeof Pusher>;

let sharedClient: PusherInstance | null = null;
let PusherCtor: typeof Pusher | null = null;

async function getClient(): Promise<PusherInstance | null> {
  if (!publicEnv.pusherKey || !publicEnv.pusherCluster) return null;
  if (sharedClient) return sharedClient;
  if (!PusherCtor) {
    PusherCtor = (await import("pusher-js")).default;
  }
  sharedClient = new PusherCtor(publicEnv.pusherKey, {
    cluster: publicEnv.pusherCluster,
    authEndpoint: "/api/pusher/auth",
  });
  return sharedClient;
}

/**
 * S'abonne à un canal temps réel si Pusher est configuré (NEXT_PUBLIC_PUSHER_*).
 * Sans configuration, ce hook ne fait rien : les composants appelants
 * doivent prévoir un repli (ex : `router.refresh()` périodique) pour rester
 * fonctionnels même sans service temps réel externe.
 *
 * Renvoie `connected`, l'état de la connexion Pusher sous-jacente (partagée
 * entre tous les composants), pour que ce repli ne tourne qu'en réel secours
 * — Pusher non configuré, ou connexion momentanément perdue — plutôt qu'en
 * continu à côté d'un canal déjà actif (voir notifications-bell.tsx et
 * conversation-panel.tsx, qui combinaient auparavant sondage systématique
 * et temps réel).
 */
export function useRealtimeChannel(
  channelName: string | null,
  handlers: Record<string, (payload: unknown) => void>
): { connected: boolean } {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!channelName) {
      setConnected(false);
      return;
    }
    let unsub: (() => void) | null = null;
    let cancelled = false;

    getClient().then((client) => {
      if (!client || cancelled) return;
      const updateConnected = () => setConnected(client.connection.state === "connected");
      client.connection.bind("state_change", updateConnected);
      updateConnected();

      const channel = client.subscribe(channelName);
      const bound: [string, (payload: unknown) => void][] = [];
      for (const event of Object.keys(handlersRef.current)) {
        const fn = (payload: unknown) => handlersRef.current[event]?.(payload);
        channel.bind(event, fn);
        bound.push([event, fn]);
      }
      unsub = () => {
        client.connection.unbind("state_change", updateConnected);
        for (const [event, fn] of bound) channel.unbind(event, fn);
        client.unsubscribe(channelName);
      };
    });

    return () => {
      cancelled = true;
      setConnected(false);
      unsub?.();
    };
  }, [channelName]);

  return { connected };
}
