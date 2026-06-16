import type { ElementPacket } from "@goldeye/engine";

// The current Lens selection, shared between the WS bridge (which writes it when
// the browser publishes) and the MCP server (which reads it when the agent pulls).
// One instance per serving process.
export interface SelectionStore {
  get(): ElementPacket | null;
  set(packet: ElementPacket | null): void;
}

export function createSelectionStore(): SelectionStore {
  let current: ElementPacket | null = null;
  return {
    get: () => current,
    set: (packet) => {
      current = packet;
    },
  };
}
