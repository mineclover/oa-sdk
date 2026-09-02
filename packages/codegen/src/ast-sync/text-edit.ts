import type { TextEdit } from './entity-spec.js';

/**
 * Creates an insertion TextEdit at a specific character offset.
 */
export function createInsertEdit(offset: number, text: string): TextEdit {
  return {
    start: offset,
    end: offset,
    newText: text,
  };
}

/**
 * Creates a replacement TextEdit between start and end character offsets.
 */
export function createReplaceEdit(start: number, end: number, text: string): TextEdit {
  return {
    start,
    end,
    newText: text,
  };
}

/**
 * Creates a deletion TextEdit between start and end character offsets.
 */
export function createDeleteEdit(start: number, end: number): TextEdit {
  return {
    start,
    end,
    newText: '',
  };
}

/**
 * Applies a list of TextEdit operations to originalSource using a reverse-offset bottom-up strategy.
 *
 * Algorithm guarantees:
 * 1. Validates descending sort order (start desc) and non-overlapping ranges (next.end <= current.start).
 * 2. 0 offset shifting: applying edits from the highest offset down to lowest offset ensures
 *    preceding edit offsets remain strictly valid without index recalculation.
 * 3. Exact trivia preservation: all characters outside edit ranges (comments, whitespace,
 *    trailing commas, formatting) remain completely untouched.
 */
export function applyTextEdits(originalSource: string, edits: TextEdit[]): string {
  if (!edits || edits.length === 0) {
    return originalSource;
  }

  // Sort descending by start offset, then by end offset descending
  const sortedEdits = [...edits].sort((a, b) => {
    if (b.start !== a.start) {
      return b.start - a.start;
    }
    return b.end - a.end;
  });

  // Range validation and overlap detection
  for (let i = 0; i < sortedEdits.length; i++) {
    const current = sortedEdits[i];
    if (!current) continue;

    if (current.start < 0 || current.end < current.start) {
      throw new Error(
        `Invalid text edit range: start (${current.start}) must be non-negative and <= end (${current.end})`
      );
    }
    if (current.end > originalSource.length) {
      throw new Error(
        `Text edit range [${current.start}, ${current.end}] exceeds source length (${originalSource.length})`
      );
    }

    if (i < sortedEdits.length - 1) {
      const next = sortedEdits[i + 1];
      if (next) {
        // In descending order: current.start >= next.start.
        // If next.end > current.start, the edits overlap.
        if (next.end > current.start) {
          throw new Error(
            `Overlapping text edit ranges: [${next.start}, ${next.end}] overlaps with [${current.start}, ${current.end}]`
          );
        }
      }
    }
  }

  // Bottom-up application
  let patched = originalSource;
  for (const edit of sortedEdits) {
    if (edit) {
      patched = patched.slice(0, edit.start) + edit.newText + patched.slice(edit.end);
    }
  }

  return patched;
}
