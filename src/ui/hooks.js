import { useSyncExternalStore, useRef } from 'react';
/** Subscribe React to any {subscribe, snapshot} source without re-implementing state. */
export function useExternal(subscribe, getSnapshot) { return useSyncExternalStore(subscribe, getSnapshot); }
export const useTimeline = (tl) => useExternal((cb) => tl.subscribe(cb), () => tl.getState());
export const useRegistry = (reg) => useExternal((cb) => reg.subscribe(cb), () => reg.getVersion());
export const useStoreVersion = (store) => {
  const v = useRef(0);
  return useExternal((cb) => store.subscribe(() => { v.current++; cb(); }), () => v.current);
};
