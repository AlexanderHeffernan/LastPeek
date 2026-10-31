// Per-tab, in-memory positions survive client navigation without persisting review capabilities.
const positions = new Map<string, number>();

export function videoPlayback(video: HTMLVideoElement, id: string) {
  let visible = false;
  let ready = false;
  let userPaused = false;
  let automaticPause = false;
  const remember = () => {
    if (!Number.isFinite(video.currentTime)) return;
    positions.delete(id);
    positions.set(id, video.currentTime);
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
  };
  const restore = () => {
    const position = positions.get(id);
    if (position && position < video.duration) video.currentTime = position;
    ready = true;
    sync();
  };
  const sync = () => {
    if (!ready || video.seeking) return;
    if (visible && !document.hidden && !userPaused) {
      void video.play().catch(() => {
        /* Native controls remain available if autoplay is blocked. */
      });
    } else if (!video.paused) {
      automaticPause = true;
      video.pause();
    }
  };
  const paused = () => {
    if (!automaticPause) userPaused = true;
    automaticPause = false;
    remember();
  };
  const playing = () => {
    userPaused = false;
  };
  video.addEventListener("loadedmetadata", restore);
  video.addEventListener("seeked", sync);
  video.addEventListener("timeupdate", remember);
  video.addEventListener("pause", paused);
  video.addEventListener("play", playing);
  document.addEventListener("visibilitychange", sync);
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      sync();
    },
    { threshold: [0, 0.5] },
  );
  observer.observe(video);
  if (video.readyState >= 1) restore();
  return {
    destroy() {
      remember();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      video.removeEventListener("loadedmetadata", restore);
      video.removeEventListener("seeked", sync);
      video.removeEventListener("timeupdate", remember);
      video.removeEventListener("pause", paused);
      video.removeEventListener("play", playing);
      video.pause();
    },
  };
}
