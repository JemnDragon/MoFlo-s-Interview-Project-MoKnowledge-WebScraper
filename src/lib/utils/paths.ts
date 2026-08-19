/**
 * Minimal dot-path get/set over plain objects.
 *
 * The field registry addresses fields by dot path so that one generic renderer
 * can handle forty fields. TypeScript cannot type-check an arbitrary runtime
 * path, so these return `unknown` and callers narrow at the use site.
 */

type Indexable = Record<string, unknown>;

function isIndexable(value: unknown): value is Indexable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAtPath(root: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (!isIndexable(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Immutably sets `value` at `path`, cloning only the objects along the way.
 * Returns a new root; the original is untouched.
 */
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const segments = path.split(".");
  const head = segments[0];
  if (head === undefined) return root;

  if (!isIndexable(root)) return root;
  const clone: Indexable = { ...root };

  if (segments.length === 1) {
    clone[head] = value;
    return clone as T;
  }

  const rest = segments.slice(1).join(".");
  clone[head] = setAtPath(clone[head] ?? {}, rest, value);
  return clone as T;
}
