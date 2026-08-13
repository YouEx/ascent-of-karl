import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/** Opretter den ignorerede arbejdsmappe først — en frisk checkout har ingen
 * `.judge/`, og mkdtempSync opretter kun det sidste led, ikke dets forælder. */
export function createVisualRunDir(root) {
  const parent = join(root, ".judge");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "visual-test-"));
}
