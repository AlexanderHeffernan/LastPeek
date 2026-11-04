// Reveals sections as they scroll into view. Content stays visible without
// JavaScript and for anything already on screen when the page hydrates.
export function reveal(element: HTMLElement) {
  if (
    !matchMedia("(prefers-reduced-motion: no-preference)").matches ||
    element.getBoundingClientRect().top < innerHeight * 0.9
  ) {
    element.dataset.reveal = "shown";
    return;
  }
  element.dataset.reveal = "pending";
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      element.dataset.reveal = "shown";
      observer.disconnect();
    },
    { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
  );
  observer.observe(element);
  return { destroy: () => observer.disconnect() };
}
