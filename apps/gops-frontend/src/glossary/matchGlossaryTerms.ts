import { allGlossaryEntries, type GlossaryEntry } from "./stockGlossary";

export type GlossarySegment = {
  text: string;
  glossaryId?: string;
};

type AliasCandidate = {
  alias: string;
  normalizedAlias: string;
  entry: GlossaryEntry;
  needsLatinBoundary: boolean;
};

type Match = {
  start: number;
  end: number;
  glossaryId: string;
};

const entriesById = new Map(allGlossaryEntries.map((entry) => [entry.id, entry]));
const aliasCandidates: AliasCandidate[] = allGlossaryEntries
  .flatMap((entry) => [...new Set([entry.term, ...entry.aliases])].map((alias) => ({
    alias,
    normalizedAlias: alias.toLocaleLowerCase(),
    entry,
    needsLatinBoundary: /[A-Za-z]/.test(alias) && !/[가-힣]/.test(alias)
  })))
  .sort((left, right) => right.alias.length - left.alias.length || left.entry.id.localeCompare(right.entry.id));

export function annotateGlossaryTerms(text: string): GlossarySegment[] {
  if (!text) {
    return [];
  }
  const normalizedText = text.toLocaleLowerCase();
  const occupied = new Uint8Array(text.length);
  const matches: Match[] = [];

  aliasCandidates.forEach((candidate) => {
    let searchFrom = 0;
    while (searchFrom <= normalizedText.length - candidate.normalizedAlias.length) {
      const start = normalizedText.indexOf(candidate.normalizedAlias, searchFrom);
      if (start < 0) {
        break;
      }
      const end = start + candidate.alias.length;
      const boundaryMatches = !candidate.needsLatinBoundary || hasLatinBoundaries(text, start, end);
      if (boundaryMatches && isRangeFree(occupied, start, end)) {
        occupied.fill(1, start, end);
        matches.push({ start, end, glossaryId: candidate.entry.id });
      }
      searchFrom = start + Math.max(1, candidate.alias.length);
    }
  });

  if (!matches.length) {
    return [{ text }];
  }
  matches.sort((left, right) => left.start - right.start);
  const segments: GlossarySegment[] = [];
  let cursor = 0;
  matches.forEach((match) => {
    if (cursor < match.start) {
      segments.push({ text: text.slice(cursor, match.start) });
    }
    segments.push({ text: text.slice(match.start, match.end), glossaryId: match.glossaryId });
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

export function glossaryEntryById(id: string): GlossaryEntry | undefined {
  return entriesById.get(id);
}

function isRangeFree(occupied: Uint8Array, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (occupied[index]) {
      return false;
    }
  }
  return true;
}

function hasLatinBoundaries(text: string, start: number, end: number): boolean {
  const previous = start > 0 ? text[start - 1] : "";
  const next = end < text.length ? text[end] : "";
  return !/[A-Za-z0-9]/.test(previous) && !/[A-Za-z0-9]/.test(next);
}
