export type CompleteHandler = (winnerSlot: "A" | "B", summary: string, penalties?: { a: number; b: number }) => void;
