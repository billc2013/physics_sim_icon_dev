// Temporary localStorage bridge.
//
// The artifact used Claude.ai's `window.storage.get/set` API. During Task 2
// we replace it with plain localStorage so the decomposed app keeps working.
// In Task 3 this entire file is deleted and useSvgs/useFeedback hooks read
// from Supabase instead.
import { STORAGE_KEY } from "./constants.js";

export function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Ignore corrupt JSON or quota errors; fall back to seed data.
  }
  return null;
}

export function saveItems(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota errors. Persistence becomes server-side in Task 3.
  }
}
