/**
 * Return true when the current active element already belongs to a webview UI
 * surface that should keep focus instead of forcing the editor to reclaim it.
 */
export function shouldPreserveFocusedElementOnWindowFocus(
  activeElement: Element | null
): boolean {
  if (!(activeElement instanceof Element)) {
    return false;
  }

  return Boolean(
    activeElement.closest('#toc-panel-wrapper')
    || activeElement.closest('.formatting-toolbar')
    || activeElement.closest('.search-overlay')
  );
}
