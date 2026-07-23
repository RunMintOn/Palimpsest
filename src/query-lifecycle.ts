export type QueryReason = "typing" | "file-open" | "sidebar-open" | "index-ready" | "layout-ready";
export interface QuerySchedule {
  immediate: boolean;
  reason: QueryReason;
}

export type QueryIndexAvailability = "uninitialized" | "ready" | "incompatible";

/**
 * Pure policy for events that may start a query. The plugin owns Editor and
 * workspace objects; this module only decides whether that real event has a
 * query-worthy Markdown context and whether it is debounced.
 */
export class QueryLifecycleCoordinator {
  private hasMarkdownContext = false;

  constructor(private indexAvailability: QueryIndexAvailability) {}

  setIndexAvailability(availability: QueryIndexAvailability): void {
    this.indexAvailability = availability;
  }

  rememberMarkdownContext(): void {
    this.hasMarkdownContext = true;
  }

  noteMarkdownActivated(): QuerySchedule | undefined {
    this.rememberMarkdownContext();
    return this.schedule("file-open", true);
  }

  nonMarkdownLeafActivated(): undefined {
    // Do not forget the last Markdown editor when an ItemView gets focus.
    return undefined;
  }

  editorChanged(): QuerySchedule | undefined {
    return this.schedule("typing", false);
  }

  sidebarOpened(): QuerySchedule | undefined {
    return this.schedule("sidebar-open", true);
  }

  indexReady(): QuerySchedule | undefined {
    this.indexAvailability = "ready";
    return this.schedule("index-ready", true);
  }

  layoutReady(): QuerySchedule | undefined {
    return this.schedule("layout-ready", true);
  }

  private schedule(reason: QueryReason, immediate: boolean): QuerySchedule | undefined {
    if (this.indexAvailability !== "ready" || !this.hasMarkdownContext) return undefined;
    return { immediate, reason };
  }
}
