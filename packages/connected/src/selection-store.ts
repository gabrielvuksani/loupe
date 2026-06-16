import type { ElementPacket } from "@goldeye/engine";

export interface TasteScore {
  score: number;
  notes: string;
}

// The current Lens selection plus the agent's optional taste read, shared between
// the WS bridge (which writes the selection when the browser publishes) and the
// MCP server (which reads it when the agent pulls). One instance per process.
export interface SelectionStore {
  get(): ElementPacket | null;
  set(packet: ElementPacket | null): void;
  getTaste(): TasteScore | null;
  setTaste(taste: TasteScore | null): void;
}

export function createSelectionStore(): SelectionStore {
  let current: ElementPacket | null = null;
  let taste: TasteScore | null = null;
  return {
    get: () => current,
    set: (packet) => {
      current = packet;
      taste = null; // a new selection invalidates the prior taste read
    },
    getTaste: () => taste,
    setTaste: (t) => {
      taste = t;
    },
  };
}
