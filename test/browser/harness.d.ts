// The contract harness.html injects onto `window`.
//
// Everything the browser suite does runs inside `page.evaluate`, which is a
// separate realm — TypeScript checks that code as if it ran here, so the
// harness globals have to be declared somewhere. Writing them down also makes
// harness.html's script block a checked interface rather than an informal one:
// rename `fetchFixture` there and the spec stops compiling.

/**
 * The loaded entry point. Only `streaming.js` and `inline.js` are loaded in the
 * browser, and both self-initialise and expose `ready()`, so this is the
 * default entry's surface exactly. Loading `slim.js` here would need a wider
 * type — it has no `ready`.
 */
type CalamineEntry = typeof import("calamine");

declare global {
  interface Window {
    /**
     * Dynamically imports `/dist/{name}`, parks it on `window.calamine`, and
     * resolves to its sorted export names.
     *
     * One entry per page, deliberately: the entries share a single glue module
     * and ES modules are singletons, so a second import in the same page would
     * see the first entry's initialisation and hide a broken loader.
     */
    loadEntry(name: string): Promise<string[]>;

    /** Set by {@link Window.loadEntry}; absent until it has resolved. */
    calamine: CalamineEntry;

    /** Fetches a fixture over real HTTP and returns its bytes. */
    fetchFixture(path: string): Promise<Uint8Array>;
  }
}

export {};
