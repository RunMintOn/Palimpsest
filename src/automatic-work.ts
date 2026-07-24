/** Tracks actual visible Palimpsest views without knowing anything about Obsidian layout internals. */
export class AutomaticWorkCoordinator<View> {
  private readonly visibleViews = new Set<View>();

  get allowed(): boolean { return this.visibleViews.size > 0; }

  setVisible(view: View, visible: boolean): boolean {
    const wasAllowed = this.allowed;
    if (visible) this.visibleViews.add(view);
    else this.visibleViews.delete(view);
    return wasAllowed !== this.allowed;
  }

  remove(view: View): boolean {
    return this.setVisible(view, false);
  }
}
