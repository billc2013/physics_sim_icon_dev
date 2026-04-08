import { useState, useEffect, useCallback, useRef } from "react";
import { STATUSES, buildSystemPrompt } from "./lib/constants.js";
import { createInitialItems } from "./lib/seedData.js";
import { loadItems, saveItems } from "./lib/storage.js";
import Header from "./components/Header.jsx";
import Toast from "./components/Toast.jsx";
import FilterBar from "./components/FilterBar.jsx";
import SvgGrid from "./components/SvgGrid.jsx";
import DetailModal from "./components/DetailModal.jsx";
import SystemPrompt from "./components/SystemPrompt.jsx";

const UNDO_LIMIT = 30;

export default function App() {
  // Lazy initial state: read localStorage once on mount, fall back to seed
  // data. localStorage is synchronous so we don't need a separate "loaded"
  // gate (the artifact had one because Claude.ai's window.storage was async).
  const [items, setItemsRaw] = useState(() => loadItems() ?? createInitialItems());
  const [modalItem, setModalItem] = useState(null);
  const [filters, setFilters] = useState(new Set(STATUSES));
  const [search, setSearch] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [toast, setToast] = useState(null);
  const [hasUndo, setHasUndo] = useState(false);

  const undoStackRef = useRef([]);
  const toastTimerRef = useRef(null);

  // Show a transient toast message that auto-dismisses.
  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // setItems wrapper that pushes the previous state onto the undo stack
  // (capped at 30 entries) and persists the new state to localStorage.
  const setItemsWithUndo = useCallback((updaterOrValue) => {
    setItemsRaw((prev) => {
      if (prev) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(UNDO_LIMIT - 1)),
          JSON.stringify(prev),
        ];
        setHasUndo(true);
      }
      const next =
        typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
      saveItems(next);
      return next;
    });
  }, []);

  const performUndo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    const previous = JSON.parse(undoStackRef.current.pop());
    setHasUndo(undoStackRef.current.length > 0);
    setItemsRaw(previous);
    saveItems(previous);
    showToast("Undone");
  }, [showToast]);

  const closeModal = useCallback(() => {
    setModalItem(null);
    setFeedbackText("");
  }, []);

  // Filter + search applied to items, in render order.
  const getVisibleItems = useCallback(() => {
    const query = search.toLowerCase();
    return items.filter(
      (item) =>
        filters.has(item.status) && (!query || item.label.toLowerCase().includes(query))
    );
  }, [items, filters, search]);

  const navigateModal = useCallback(
    (direction) => {
      if (!modalItem) return;
      const visible = getVisibleItems();
      const index = visible.findIndex((x) => x.id === modalItem.id);
      const next = visible[index + direction];
      if (next) {
        setModalItem(next);
        setFeedbackText("");
      }
    },
    [modalItem, getVisibleItems]
  );

  // Global keyboard shortcuts: Cmd/Ctrl+Z undo (when no modal open),
  // Esc to close overlays, Left/Right to nav within the modal.
  useEffect(() => {
    const handleKeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !modalItem) {
        e.preventDefault();
        performUndo();
      }
      if (e.key === "Escape") {
        if (showSystemPrompt) setShowSystemPrompt(false);
        else if (modalItem) closeModal();
      }
      if (modalItem && !showSystemPrompt && e.key === "ArrowLeft") navigateModal(-1);
      if (modalItem && !showSystemPrompt && e.key === "ArrowRight") navigateModal(1);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [modalItem, showSystemPrompt, closeModal, navigateModal, performUndo]);

  // Keep the modal in sync with the underlying item when it gets edited.
  const syncModalIfMatching = (id, updater) => {
    if (modalItem?.id === id) setModalItem((m) => updater(m));
  };

  const updateStatus = (id, status) => {
    setItemsWithUndo((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
    syncModalIfMatching(id, (m) => ({ ...m, status }));
  };

  const updateNotes = (id, notes) => {
    setItemsWithUndo((prev) =>
      prev.map((item) => (item.id === id ? { ...item, notes } : item))
    );
    syncModalIfMatching(id, (m) => ({ ...m, notes }));
  };

  const updateColor = (id, colorTag) => {
    setItemsWithUndo((prev) =>
      prev.map((item) => (item.id === id ? { ...item, colorTag } : item))
    );
    syncModalIfMatching(id, (m) => ({ ...m, colorTag }));
  };

  // Adding feedback to a draft auto-promotes it to "revised". Other statuses
  // keep their existing status when feedback is added.
  const addFeedback = (id) => {
    if (!feedbackText.trim()) return;
    const entry = { text: feedbackText.trim(), date: new Date().toISOString() };
    setItemsWithUndo((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              feedback: [...item.feedback, entry],
              status: item.status === "draft" ? "revised" : item.status,
            }
          : item
      )
    );
    syncModalIfMatching(id, (m) => ({
      ...m,
      feedback: [...m.feedback, entry],
      status: m.status === "draft" ? "revised" : m.status,
    }));
    setFeedbackText("");
    showToast("Feedback saved");
  };

  // Filter solo behavior: clicking a status when all are shown solos that
  // status; clicking the soloed status restores all four. Otherwise toggles.
  const toggleFilter = (status) => {
    setFilters((prev) => {
      if (prev.size === STATUSES.length) return new Set([status]);
      if (prev.size === 1 && prev.has(status)) return new Set(STATUSES);
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next.size === 0 ? new Set(STATUSES) : next;
    });
  };

  const handleAllDraftsToIdea = () => {
    setItemsWithUndo((prev) =>
      prev.map((item) => (item.status === "draft" ? { ...item, status: "idea_only" } : item))
    );
    showToast("All drafts \u2192 idea only");
  };

  // Stub handlers for the generation pipeline. The real implementation
  // ships in Task 8 (GeneratePanel + Vercel proxy + Modal). For now these
  // just toast so the UI buttons remain visible and clickable but inert.
  const handleGenerateMore = () => {
    showToast("Generation pipeline ships in Phase 3");
  };
  const handleDownloadApproved = () => {
    const approved = items.filter((item) => item.status === "approved");
    if (!approved.length) {
      showToast("No approved SVGs");
      return;
    }
    showToast("Export pipeline ships in Phase 4");
  };
  const handleSendToClaude = (item) => {
    void item;
    showToast("Generation pipeline ships in Phase 3");
  };

  const visibleItems = getVisibleItems();
  const statusCounts = STATUSES.reduce((acc, status) => {
    acc[status] = items.filter((item) => item.status === status).length;
    return acc;
  }, {});
  const systemPromptText = buildSystemPrompt(items);

  return (
    <div
      style={{
        padding: "1rem",
        fontFamily: "var(--font-sans)",
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <Toast message={toast} />

      <Header
        itemCount={items.length}
        hasUndo={hasUndo}
        onUndo={performUndo}
        onGenerateMore={handleGenerateMore}
        onShowSystemPrompt={() => setShowSystemPrompt(true)}
        onDownloadApproved={handleDownloadApproved}
      />

      <input
        type="text"
        placeholder="Search objects..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: "100%", marginBottom: 10 }}
      />

      <FilterBar
        filters={filters}
        statusCounts={statusCounts}
        onToggleFilter={toggleFilter}
        onAllDraftsToIdea={handleAllDraftsToIdea}
      />

      <SvgGrid
        items={visibleItems}
        onItemClick={(item) => {
          setModalItem(item);
          setFeedbackText("");
        }}
      />

      {modalItem && (
        <DetailModal
          item={modalItem}
          feedbackText={feedbackText}
          onFeedbackTextChange={setFeedbackText}
          onClose={closeModal}
          onUpdateStatus={updateStatus}
          onUpdateColor={updateColor}
          onUpdateNotes={updateNotes}
          onAddFeedback={addFeedback}
          onPrevious={() => navigateModal(-1)}
          onNext={() => navigateModal(1)}
          onSendToClaude={handleSendToClaude}
        />
      )}

      {showSystemPrompt && (
        <SystemPrompt
          promptText={systemPromptText}
          onClose={() => setShowSystemPrompt(false)}
        />
      )}
    </div>
  );
}
