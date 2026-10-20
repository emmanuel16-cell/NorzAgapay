import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/api';

/** Refreshes the current view after a server change or a socket reconnect. */
export function useRealtimeRefresh(
  refresh: () => void | Promise<unknown>,
  options: { publicUpdates?: boolean; events?: readonly string[] } = {},
) {
  const refreshRef = useRef(refresh);
  const eventNamesKey = (options.events || []).join('\u0000');
  const publicUpdates = options.publicUpdates === true;

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const scheduleRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void Promise.resolve(refreshRef.current()).catch(() => undefined);
      }, 120);
    };
    const eventNames = eventNamesKey ? eventNamesKey.split('\u0000') : [];

    socket.on('dashboard:data_changed', scheduleRefresh);
    if (publicUpdates) socket.on('public:data_changed', scheduleRefresh);
    socket.on('connect', scheduleRefresh);
    document.addEventListener('visibilitychange', scheduleRefresh);
    eventNames.forEach((eventName) => socket.on(eventName, scheduleRefresh));

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      socket.off('dashboard:data_changed', scheduleRefresh);
      if (publicUpdates) socket.off('public:data_changed', scheduleRefresh);
      socket.off('connect', scheduleRefresh);
      document.removeEventListener('visibilitychange', scheduleRefresh);
      eventNames.forEach((eventName) => socket.off(eventName, scheduleRefresh));
    };
  }, [eventNamesKey, publicUpdates]);
}

export function useRealtimeConnection(): boolean {
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return connected;
}
