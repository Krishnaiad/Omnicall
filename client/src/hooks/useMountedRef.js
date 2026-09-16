import { useRef, useEffect } from 'react';

/**
 * Returns a ref whose `.current` is `true` while the component is mounted
 * and `false` after it unmounts.
 *
 * Use to guard async callbacks that may resolve after unmount:
 *
 *   const isMountedRef = useMountedRef();
 *   try {
 *     const data = await api.login(...);
 *     onAuthSuccess(data); // unmounts this component
 *   } catch (err) {
 *     if (isMountedRef.current) setError(err.message);
 *   }
 *
 * Extracted as a shared hook so AuthScreen and GuestJoinLobby can't drift apart.
 */
export function useMountedRef() {
  const ref = useRef(true);
  useEffect(() => () => { ref.current = false; }, []);
  return ref;
}
