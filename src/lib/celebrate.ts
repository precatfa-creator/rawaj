import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../db/supabase';

/**
 * A completed delivery, announced to everyone working the store.
 *
 * Broadcast rather than derived from the row change: `postgres_changes` only
 * carries the primary key of the old row unless the table is set to REPLICA
 * IDENTITY FULL, so a listener cannot tell "just became delivered" from "was
 * already delivered and something else moved". An explicit announcement fires
 * exactly once, at the moment somebody completes the order.
 *
 * The channel is per store, so a delivery in one store never interrupts people
 * working in another.
 */
export interface Delivery {
  orderNumber: string;
  customerName: string;
  total: number;
  /** Who completed it, for the line under the headline. */
  by: string;
  /** Distinguishes two deliveries that arrive in the same second. */
  at: number;
}

/**
 * One channel per store, shared by the listener and the sender.
 *
 * Realtime allows a client only one subscription per topic, so opening a second
 * channel on the same name to send on — which is the obvious way to write this —
 * silently never delivers: the join is refused and the message goes nowhere.
 * Both sides go through here instead.
 *
 * Channels are kept for the session rather than reference-counted. A person
 * visits a handful of stores at most, and an idle channel costs one socket
 * topic; tearing down on the last listener would mean re-joining every time the
 * overlay unmounts.
 */
const channels = new Map<string, RealtimeChannel>();
const listeners = new Map<string, Set<(delivery: Delivery) => void>>();

const topic = (storeId: string) => `celebrate:${storeId}`;

const channelFor = (storeId: string): RealtimeChannel => {
  const existing = channels.get(storeId);
  if (existing) return existing;

  const channel = supabase
    // `self: true` so the person who completed the order sees it too — they are
    // the one who earned it, and a celebration everybody but the sender sees
    // reads as a bug.
    .channel(topic(storeId), { config: { broadcast: { self: true } } })
    .on('broadcast', { event: 'delivered' }, ({ payload }) => {
      listeners.get(storeId)?.forEach(notify => notify(payload as Delivery));
    });

  channel.subscribe();
  channels.set(storeId, channel);
  return channel;
};

/**
 * Tells the store an order was delivered in full.
 *
 * Fire-and-forget on purpose: the delivery is already saved, and a party nobody
 * saw is not worth failing a write over.
 */
export const announceDelivery = async (
  storeId: string,
  delivery: Omit<Delivery, 'by' | 'at'>,
): Promise<void> => {
  try {
    // Resolved here rather than passed in: every caller would otherwise have to
    // carry the signed-in profile down to the point of the write just to name
    // it, and would have to remember the timestamp too.
    const { data } = await supabase.auth.getUser();
    const by = (data.user?.user_metadata?.display_name as string) || data.user?.email || '';

    await channelFor(storeId).send({
      type: 'broadcast',
      event: 'delivered',
      payload: { ...delivery, by, at: Date.now() } satisfies Delivery,
    });
  } catch (error) {
    console.error('celebration broadcast failed', error);
  }
};

/** The delivery to celebrate right now, or null. */
export const useDeliveryCelebration = (storeId: string | null) => {
  const [delivery, setDelivery] = useState<Delivery | null>(null);

  useEffect(() => {
    // Leaving a store must not carry its celebration into the next one.
    setDelivery(null);
    if (!storeId) return;

    channelFor(storeId);
    const notify = (next: Delivery) => setDelivery(next);
    const forStore = listeners.get(storeId) ?? new Set();
    forStore.add(notify);
    listeners.set(storeId, forStore);

    return () => { forStore.delete(notify); };
  }, [storeId]);

  return { delivery, dismiss: () => setDelivery(null) };
};
