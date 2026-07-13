/**
 * Detect touch / phone-tablet style input (not desktop with optional touch).
 */
export function detectMobileInput() {
  if (typeof window === 'undefined') return false;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const touchPoints = (navigator.maxTouchPoints ?? 0) > 0;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );

  // Coarse pointer + no hover covers phones/tablets; UA catches iPadOS desktop-mode edge cases.
  return (coarse && noHover) || (touchPoints && mobileUa) || (coarse && touchPoints && window.innerWidth < 1024);
}

export function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}
