import { useState, useEffect, useCallback, useRef } from "react";
import { STATUSES, buildSystemPrompt } from "./lib/constants.js";
import { useAuth } from "./hooks/useAuth.js";
import { useSvgs } from "./hooks/useSvgs.js";
import LoginPage from "./components/LoginPage.jsx";
import Header from "./components/Header.jsx";
import Toast from "./components/Toast.jsx";
import FilterBar from "./components/FilterBar.jsx";
import SvgGrid from "./components/SvgGrid.jsx";
import DetailModal from "./components/DetailModal.jsx";
import SystemPrompt from "./components/SystemPrompt.jsx";

export default function App() {
  const auth = useAuth();

  // Auth gate. While Supabase is restoring the session we render nothing
  // (rather than flashing the login screen at users who are already in).
  if (auth.loading) {
    return <CenteredMessage>Loading...</CenteredMessage>;
  }
  if (!auth.user) {
    return <LoginPage onSignIn={auth.signIn} onSignUp={auth.signUp} />;
  }

  return <SignedInApp user={auth.user} onSignOut={auth.signOut} />;
}

function SignedInApp({ user, onSignOut }) {
  const svgs = useSvgs(user);

  // UI state.
  const [modalItemId, setModalItemId] = useState(null);
  const [filters, setFilters] = useState(new Set(STATUSES));
  const [search, setSearch] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const closeModal = useCallback(() => {
    setModalItemId(null);
    setFeedbackText("");
  }, []);

  // Filter + search applied to items, in render order. Memoised against
  // the items array reference so we don't re-filter on unrelated renders.
  const items = svgs.items;
  const getVisibleItems = useCallback(() => {
    if (!items) return [];
    const query = search.toLowerCase();
    return items.filter(
      (item) =>
        filters.has(item.status) && (!query || item.label.toLowerCase().includes(query))
    );
  }, [items, filters, search]);

  // Look up the current modal item by id on every render so edits flow
  // through automatically (no need for a separate "syncModalIfMatching"
  // helper as the artifact had).
  const modalItem = modalItemId && items ? items.find((i) => i.id === modalItemId) : null;

  const navigateModal = useCallback(
    (direction) => {
      if (!modalItem) return;
      const visible = getVisibleItems();
      const index = visible.findIndex((x) => x.id === modalItem.id);
      const next = visible[index + direction];
      if (next) {
        setModalItemId(next.id);
        setFeedbackText("");
      }
    },
    [modalItem, getVisibleItems]
  );

  // Keyboard shortcuts. Cmd/Ctrl+Z used to trigger undo; that's gone now.
  useEffect(() => {
    const handleKeydown = (e) => {
      if (e.key === "Escape") {
        if (showSystemPrompt) setShowSystemPrompt(false);
        else if (modalItem) closeModal();
      }
      if (modalItem && !showSystemPrompt && e.key === "ArrowLeft") navigateModal(-1);
      if (modalItem && !showSystemPrompt && e.key === "ArrowRight") navigateModal(1);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [modalItem, showSystemPrompt, closeModal, navigateModal]);

  // Mutation handlers. Wrap useSvgs mutations with try/catch so we can
  // surface errors via the toast (the hook already rolls back local state).
  const wrapMutation = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };

  const updateStatus = wrapMutation(svgs.updateStatus);
  const updateNotes = wrapMutation(svgs.updateNotes);
  const updateColor = wrapMutation(svgs.updateColor);

  const addFeedback = async (id) => {
    if (!feedbackText.trim()) return;
    try {
      await svgs.addFeedback(id, feedbackText);
      setFeedbackText("");
      showToast("Feedback saved");
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
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

  const handleAllDraftsToIdea = async () => {
    try {
      await svgs.promoteAllDraftsToIdea();
      showToast("All drafts \u2192 idea only");
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };

  // Stub handlers for the generation pipeline. The Modal function exists
  // (Task 3) but the Vercel proxy and React UI ship in Tasks 6 and 7.
  const handleGenerateMore = () => {
    showToast("Generation UI ships in Phase 3");
  };
  const handleDownloadApproved = () => {
    if (!items) return;
    const approved = items.filter((item) => item.status === "approved");
    if (!approved.length) {
      showToast("No approved SVGs");
      return;
    }
    showToast("Export pipeline ships in Phase 4");
  };
  const handleSendToClaude = () => {
    showToast("Generation UI ships in Phase 3");
  };

  // Loading / error states for the initial data load (separate from the
  // auth gate above). Mutation errors get surfaced via toast in the
  // wrapMutation helpers.
  if (svgs.loading && !items) {
    return <CenteredMessage>Loading library...</CenteredMessage>;
  }
  if (svgs.error && !items) {
    return (
      <CenteredMessage>
        Failed to load: {svgs.error.message ?? String(svgs.error)}
      </CenteredMessage>
    );
  }
  if (!items) {
    return <CenteredMessage>No items.</CenteredMessage>;
  }

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
        userEmail={user.email}
        onSignOut={onSignOut}
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
          setModalItemId(item.id);
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

function CenteredMessage({ children }) {
  return (
    <div
      style={{
        padding: "2rem",
        textAlign: "center",
        color: "var(--color-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
