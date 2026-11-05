const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function fixtureId(competitionId: string, round: number, matchNumber: number): string {
  const mm = String(matchNumber).padStart(2, "0");
  return `${competitionId}-r${round}-m${mm}`;
}

export function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class PhoneError extends Error {}

export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, "");
  const match = stripped.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  if (!match) {
    throw new PhoneError(`INVALID_PHONE: ${raw}`);
  }
  return `+91${match[1]}`;
}
