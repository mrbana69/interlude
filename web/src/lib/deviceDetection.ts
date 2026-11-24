export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/**
 * Rileva in modo affidabile se il client è uno smartphone, un tablet o un desktop/Smart TV,
 * anche se sul telefono l'utente attiva "Richiedi sito desktop".
 */
export function getDeviceType(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';

  const ua = navigator.userAgent || '';
  const isTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;

  // Dimensioni minime fisiche dello schermo e della finestra
  const screenMin = Math.min(window.screen.width, window.screen.height);
  const winMin = Math.min(window.innerWidth, window.innerHeight);
  const minDimension = Math.min(screenMin, winMin);

  // 1. Riconoscimento esplicito User-Agent mobile
  const isExplicitMobile = /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  // 2. Riconoscimento esplicito User-Agent tablet
  const isExplicitTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);

  // 3. iPad con iPadOS che si spaccia per MacIntel (Desktop Mode di default)
  const isIPadDesktop = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;

  // 4. SMARTPHONE CHECK (ROBUSTO ANCHE IN MODALITÀ DESKTOP):
  // Anche se un iPhone o smartphone Android attiva "Richiedi sito desktop",
  // lo schermo fisico CSS (screen.width/height) ha una dimensione minima sempre inferiore a 560px.
  // Nessun desktop o TV ha touch attivo e dimensione inferiore a 600px.
  if (isExplicitMobile || (isTouch && minDimension < 600)) {
    return 'mobile';
  }

  // 5. TABLET CHECK:
  // Dispositivo touch con dimensione minima tra 600px e 1024px
  if (isExplicitTablet || isIPadDesktop || (isTouch && minDimension >= 600 && minDimension <= 1024)) {
    return 'tablet';
  }

  return 'desktop';
}
