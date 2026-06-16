import type { ElementPacket } from "@loupe/engine";

export interface TasteScore {
  score: number;
  notes: string;
}

// The current Lens selection, the agent's optional taste read, and the user's
// optional request ("what they want changed"), shared between the WS bridge
// (which writes them when the browser publishes or dispatches) and the MCP
// server (which reads them when the agent pulls). One instance per process.
export interface SelectionStore {
  get(): ElementPacket | null;
  set(packet: ElementPacket | null): void;
  getTaste(): TasteScore | null;
  setTaste(taste: TasteScore | null): void;
  getRequest(): string | null;
  setRequest(request: string | null): void;
}

export function createSelectionStore(): SelectionStore {
  let current: ElementPacket | null = null;
  let taste: TasteScore | null = null;
  let request: string | null = null;
  return {
    get: () => current,
    set: (packet) => {
      current = packet;
      taste = null; // a new selection invalidates the prior taste read
      request = null; // and the prior request
    },
    getTaste: () => taste,
    setTaste: (t) => {
      taste = t;
    },
    getRequest: () => request,
    setRequest: (r) => {
      request = r;
    },
  };
}
