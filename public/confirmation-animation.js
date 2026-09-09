/* Decorative only. No checkout, payment or analytics calls belong here. */
(() => {
  const page = document.querySelector("[data-confirmation]");
  if (!page || page.dataset.confirmation !== "success") return;
  if (page.dataset.animationEnabled !== "true" || page.dataset.animationStyle === "none") return;
  try {
    if (page.dataset.confirmationPreview !== "true") {
      const key = `commera:confirmation:${page.dataset.orderKey}`;
      if (!page.dataset.orderKey || sessionStorage.getItem(key)) return;
      // Record before playback, including reduced motion, so refresh never replays.
      sessionStorage.setItem(key, "seen");
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    page.classList.add("confirmation-play");
    if (page.dataset.animationStyle === "confetti") page.classList.add("confirmation-celebrate");
    const stop = () => page.classList.remove("confirmation-play", "confirmation-celebrate");
    const changed = event => { if (event.matches) stop(); };
    motion.addEventListener?.("change", changed);
    window.setTimeout(() => {
      stop();
      motion.removeEventListener?.("change", changed);
    }, 1100);
  } catch {
    // Blocked session storage or unsupported APIs leave the complete static page.
    page.classList.remove("confirmation-play", "confirmation-celebrate");
  }
})();
