export function isNearBottom(el: HTMLElement, thresholdPx = 120): boolean {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance < thresholdPx;
}

export function scrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}
