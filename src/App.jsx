import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import JSZip from "jszip";
import { STATUSES, buildSystemPrompt } from "./lib/constants.js";
import { useAuth } from "./hooks/useAuth.js";
import { useSvgs } from "./hooks/useSvgs.js";
import { useGeneration } from "./hooks/useGeneration.js";
import { useGenerationQueue } from "./hooks/useGenerationQueue.js";
import LoginPage from "./components/LoginPage.jsx";
import Header from "./components/Header.jsx";
import TabStrip from "./components/TabStrip.jsx";
import Toast from "./components/Toast.jsx";
import FilterBar from "./components/FilterBar.jsx";
import SvgGrid from "./components/SvgGrid.jsx";
import DetailModal from "./components/DetailModal.jsx";
import SystemPrompt from "./components/SystemPrompt.jsx";
import GenerateNewModal from "./components/GenerateNewModal.jsx";
import BatchGenerateModal from "./components/BatchGenerateModal.jsx";
import DownloadApprovedModal from "./components/DownloadApprovedModal.jsx";
import QueuePanel from "./components/QueuePanel.jsx";
import DataTransformPage from "./components/data/DataTransformPage.jsx";

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

  // Flow A (Generate one) stays blocking because you need to name the
  // item. Everything else (Flows B, C, D) is fire-and-forget via the queue.
  const newGeneration = useGeneration();
  const queue = useGenerationQueue();

  // Active top-level tool. "svg" = SVG Manager, "data" = Data Transforms.
  // Both tools share auth and layout but their inner state stays scoped.
  const [activeTab, setActiveTab] = useState("svg");

  // UI state.
  const [modalItemId, setModalItemId] = useState(null);
  const [filters, setFilters] = useState(new Set(STATUSES));
  const [search, setSearch] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  // Model tier for the revise flow. Lives here (not in DetailModal) so that
  // closeModal/openModalForId can reset it alongside feedbackText and the
  // reviseGeneration state — keeping Advanced from being sticky across items.
  const [reviseModelTier, setReviseModelTier] = useState("standard");
  // Pending manual SVG upload, awaiting Accept/Discard. Shape:
  //   { svg: string, warning: string|null } | null
  // Lives here so navigation/close cleanly clears it like the other
  // per-item state.
  const [pendingUpload, setPendingUpload] = useState(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showGenerateNew, setShowGenerateNew] = useState(false);
  const [showBatchGenerate, setShowBatchGenerate] = useState(false);
  const [showDownloadApproved, setShowDownloadApproved] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  // FilterBar "Downloaded" toggle — when on, further restricts the grid to
  // items that have been exported at least once. Composes with the status
  // filter set (AND, not OR).
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Wire queue completion/error toasts
  useEffect(() => {
    queue.setOnComplete((job) => {
      showToast(`${job.label} ready — open Queue to review`);
    });
    queue.setOnError((job) => {
      showToast(`${job.label} failed`);
    });
  }, [queue, showToast]);

  const closeModal = useCallback(() => {
    setModalItemId(null);
    setFeedbackText("");
    setReviseModelTier("standard");
    setPendingUpload(null);
  }, []);

  const openModalForId = useCallback((id) => {
    setModalItemId(id);
    setFeedbackText("");
    setReviseModelTier("standard");
    setPendingUpload(null);
  }, []);

  // Filter + search applied to items, in render order. Memoised against
  // the items array reference so we don't re-filter on unrelated renders.
  const items = svgs.items;
  const getVisibleItems = useCallback(() => {
    if (!items) return [];
    const query = search.toLowerCase();
    return items.filter((item) => {
      if (!filters.has(item.status)) return false;
      if (query && !item.label.toLowerCase().includes(query)) return false;
      if (downloadedOnly && item.lastExportedAt == null) return false;
      return true;
    });
  }, [items, filters, search, downloadedOnly]);

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
        openModalForId(next.id);
      }
    },
    [modalItem, getVisibleItems, openModalForId]
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
  const updatePhysicalProperties = wrapMutation(svgs.updatePhysicalProperties);

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

  // ---------- Generation handlers ----------

  // Names already in the library, used by Flow A for collision detection.
  const existingNames = useMemo(
    () => new Set((items ?? []).map((i) => i.id)),
    [items]
  );

  // Flow A: open the "generate new" modal.
  const handleGenerateMore = () => {
    newGeneration.reset();
    setShowGenerateNew(true);
  };
  const handleCloseGenerateNew = () => {
    setShowGenerateNew(false);
    newGeneration.reset();
  };
  const handleNewGenerate = async ({ objectName, colorTag, modelTier }) => {
    await newGeneration.generate({ objectName, colorTag, modelTier });
  };
  const handleNewAccept = async ({ name, displayName, svgContent, collider }) => {
    try {
      await svgs.insertSvg({
        name,
        displayName,
        svgContent,
        physicalProperties: collider ? { collider } : null,
      });
      showToast(`Added "${displayName}"`);
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
      throw e; // let GenerateNewModal stay open so the user can retry
    }
  };
  // If the user types a name that already exists, give them a one-click
  // jump to the detail modal so they can revise instead.
  const handleJumpToExisting = (name) => {
    handleCloseGenerateNew();
    openModalForId(name);
  };

  // Batch generate: category mode (Header "Batch generate")
  // Fire-and-forget: adds a job to the queue, closes the modal.
  const handleOpenBatchGenerate = () => {
    setShowBatchGenerate(true);
  };
  const handleCloseBatchGenerate = () => {
    setShowBatchGenerate(false);
  };
  const handleBatchGenerate = ({ category, count, modelTier, referenceIds }) => {
    // Look up the full SVG markup for each selected reference so the
    // Modal function can include it in the prompt. We filter out any ids
    // that no longer exist (defensive — shouldn't happen in normal flow).
    const referenceSvgs = (referenceIds || [])
      .map((id) => {
        const match = items?.find((it) => it.id === id);
        return match ? { name: match.id, svg: match.svg } : null;
      })
      .filter(Boolean);

    queue.addJob({
      type: "batch_category",
      label: `${category} — batch ${count}${referenceSvgs.length ? ` · ${referenceSvgs.length} ref` : ""}`,
      request: {
        mode: "category",
        category,
        count,
        modelTier,
        referenceSvgs,
      },
    });
    showToast("Batch generate queued");
  };

  // Flow B: send the currently-open detail modal item to Claude for revision.
  // Fire-and-forget: adds a job to the queue. The user can close the
  // DetailModal and review the result in QueuePanel when it's ready.
  const handleSendToClaude = (item) => {
    const feedbackHistory = item.feedback.map((f) => f.text);
    if (feedbackText.trim()) feedbackHistory.push(feedbackText.trim());
    queue.addJob({
      type: "revise",
      label: `${item.label} — revise`,
      request: {
        objectName: item.id,
        colorTag: item.colorTag,
        svgId: item._uuid,
        feedbackHistory: feedbackHistory.length ? feedbackHistory : null,
        currentSvg: item.svg,
        modelTier: reviseModelTier,
        itemId: item.id,
      },
    });
    showToast("Revision queued");
  };

  // Manual SVG upload accept/discard. Goes through updateSvgContent so
  // versioning and draft→revised promotion work identically to revisions.
  const handleAcceptUpload = async (id) => {
    if (!pendingUpload) return;
    try {
      await svgs.updateSvgContent(id, pendingUpload.svg);
      setPendingUpload(null);
      showToast("Upload saved");
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };
  const handleDiscardUpload = () => {
    setPendingUpload(null);
  };

  // Color variant generation: fire-and-forget to queue. Color variants
  // are inserted as NEW items named {color}_{objectName}, not as
  // replacements of the existing item.
  const handleGenerateColorVariants = (item, colorTags, tierForVariants) => {
    const feedbackHistory = item.feedback.map((f) => f.text);
    if (feedbackText.trim()) feedbackHistory.push(feedbackText.trim());
    queue.addJob({
      type: "batch_colors",
      label: `${item.label} — ${colorTags.length} colors`,
      request: {
        mode: "color_variants",
        objectName: item.id,
        svgId: item._uuid,
        currentSvg: item.svg,
        feedbackHistory: feedbackHistory.length ? feedbackHistory : null,
        colorTags,
        modelTier: tierForVariants,
      },
    });
    showToast("Color variants queued");
  };

  // ---------- Queue accept handlers (called from QueuePanel) ----------

  const handleQueueAcceptRevise = async (job) => {
    try {
      await svgs.updateSvgContent(job.request.itemId, job.result.svg);
      if (job.result.collider) {
        // Save collider to the parent (or self if no parent). This
        // ensures all color variants inherit the updated collider.
        const item = items?.find((i) => i.id === job.request.itemId);
        const colliderTarget = item?.parentId ?? job.request.itemId;
        await svgs.updatePhysicalProperties(colliderTarget, {
          collider: job.result.collider,
        });
      }
      queue.discardJob(job.id);
      showToast("Revision saved");
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };

  const handleQueueAcceptBatch = async (job, selectedItems) => {
    try {
      for (const item of selectedItems) {
        await svgs.insertSvg({
          name: item.name,
          displayName: item.name.replace(/_/g, " "),
          svgContent: item.svg,
          physicalProperties: item.collider ? { collider: item.collider } : null,
        });
      }
      queue.discardJob(job.id);
      showToast(`Added ${selectedItems.length} SVGs`);
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };

  const handleQueueAcceptColors = async (job, selectedItems) => {
    try {
      // The source item is the parent. If the source itself is a child,
      // use its parent instead (one-level-only rule).
      const sourceItem = items?.find((i) => i._uuid === job.request.svgId);
      const parentUuid = sourceItem?._parentUuid || job.request.svgId;
      for (const item of selectedItems) {
        await svgs.insertSvg({
          name: item.name,
          displayName: item.name.replace(/_/g, " "),
          svgContent: item.svg,
          colorTag: item.color,
          parentUuid,
        });
      }
      queue.discardJob(job.id);
      showToast(`Added ${selectedItems.length} color variants`);
    } catch (e) {
      showToast(`Error: ${e.message ?? e}`);
    }
  };

  // "Download approved" — opens the scope/manifest dialog. The dialog
  // itself calls handleConfirmDownload with the selected items.
  const handleDownloadApproved = () => {
    if (!items) return;
    const approved = items.filter((item) => item.status === "approved");
    if (!approved.length) {
      showToast("No approved SVGs");
      return;
    }
    setShowDownloadApproved(true);
  };

  // Build the zip, trigger download, stamp the DB. Called from
  // DownloadApprovedModal once the user has picked scope + manifest option.
  const handleConfirmDownload = async ({ mode, includeManifest, items: selectedItems }) => {
    if (!selectedItems?.length) return;

    const zip = new JSZip();
    for (const item of selectedItems) {
      zip.file(`${item.id}.svg`, item.svg);
    }

    if (includeManifest) {
      const manifest = {
        manifest_version: 1,
        exported_at: new Date().toISOString(),
        exported_by: user.email,
        export_mode: mode,
        items: selectedItems.map((item) => ({
          name: item.id,
          display_name: item.label,
          status: item.status,
          version: item.version,
          color_tag: item.colorTag,
          parent: item.parentId ?? null,
          physical_properties: item.effectivePhysicalProperties,
        })),
      };
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const dateStamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `physics-sim-svgs-${dateStamp}.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Stamp the DB. If this throws the user has still downloaded the zip,
    // so we surface the error but don't undo the download.
    try {
      await svgs.markExported(selectedItems.map((item) => item._uuid));
      showToast(`Downloaded ${selectedItems.length} SVGs`);
    } catch (e) {
      showToast(
        `Downloaded, but failed to stamp export: ${e.message ?? e}`
      );
    }
  };

  const shellWrapperStyle = {
    padding: "1rem",
    fontFamily: "var(--font-sans)",
    maxWidth: 960,
    margin: "0 auto",
  };

  // The SVG Manager loads its dataset from Supabase, but the Data Transforms
  // tool doesn't depend on that — only block on `svgs.loading` when the user
  // is actually on the SVG tab.
  if (activeTab === "svg" && svgs.loading && !items) {
    return (
      <div style={shellWrapperStyle}>
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          userEmail={user.email}
          onSignOut={onSignOut}
        />
        <CenteredMessage>Loading library...</CenteredMessage>
      </div>
    );
  }
  if (activeTab === "svg" && svgs.error && !items) {
    return (
      <div style={shellWrapperStyle}>
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          userEmail={user.email}
          onSignOut={onSignOut}
        />
        <CenteredMessage>
          Failed to load: {svgs.error.message ?? String(svgs.error)}
        </CenteredMessage>
      </div>
    );
  }

  if (activeTab === "data") {
    return (
      <div style={shellWrapperStyle}>
        <Toast message={toast} />
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          userEmail={user.email}
          onSignOut={onSignOut}
        />
        <DataTransformPage userEmail={user.email} />
      </div>
    );
  }

  // SVG tab — items are loaded.
  if (!items) {
    return (
      <div style={shellWrapperStyle}>
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          userEmail={user.email}
          onSignOut={onSignOut}
        />
        <CenteredMessage>No items.</CenteredMessage>
      </div>
    );
  }

  const visibleItems = getVisibleItems();
  const statusCounts = STATUSES.reduce((acc, status) => {
    acc[status] = items.filter((item) => item.status === status).length;
    return acc;
  }, {});
  const approvedItems = items.filter((item) => item.status === "approved");
  const downloadedCount = items.filter((item) => item.lastExportedAt != null).length;
  const systemPromptText = buildSystemPrompt(items);

  return (
    <div style={shellWrapperStyle}>
      <Toast message={toast} />

      <TabStrip
        activeTab={activeTab}
        onChange={setActiveTab}
        userEmail={user.email}
        onSignOut={onSignOut}
      />

      <Header
        itemCount={items.length}
        onGenerateMore={handleGenerateMore}
        onBatchGenerate={handleOpenBatchGenerate}
        onShowQueue={() => setShowQueue(true)}
        queueCounts={queue}
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
        downloadedOnly={downloadedOnly}
        onToggleDownloadedOnly={() => setDownloadedOnly((v) => !v)}
        downloadedCount={downloadedCount}
      />

      <SvgGrid
        items={visibleItems}
        onItemClick={(item) => openModalForId(item.id)}
      />

      {modalItem && (
        <DetailModal
          key={modalItem.id}
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
          onGenerateColorVariants={handleGenerateColorVariants}
          itemQueueJobs={queue.getJobsForItem(modalItem.id)}
          modelTier={reviseModelTier}
          onModelTierChange={setReviseModelTier}
          pendingUpload={pendingUpload}
          onPendingUploadChange={setPendingUpload}
          onAcceptUpload={handleAcceptUpload}
          onDiscardUpload={handleDiscardUpload}
          onUpdatePhysicalProperties={updatePhysicalProperties}
        />
      )}

      {showGenerateNew && (
        <GenerateNewModal
          existingNames={existingNames}
          generation={newGeneration}
          onGenerate={handleNewGenerate}
          onAccept={handleNewAccept}
          onClose={handleCloseGenerateNew}
          onJumpToExisting={handleJumpToExisting}
        />
      )}

      {showBatchGenerate && (
        <BatchGenerateModal
          items={items}
          onGenerate={handleBatchGenerate}
          onClose={handleCloseBatchGenerate}
        />
      )}

      {showQueue && (
        <QueuePanel
          jobs={queue.jobs}
          existingNames={existingNames}
          onAcceptRevise={handleQueueAcceptRevise}
          onAcceptBatch={handleQueueAcceptBatch}
          onAcceptColors={handleQueueAcceptColors}
          onDiscard={queue.discardJob}
          onRetry={queue.retryJob}
          onClose={() => setShowQueue(false)}
        />
      )}

      {showDownloadApproved && (
        <DownloadApprovedModal
          approvedItems={approvedItems}
          onClose={() => setShowDownloadApproved(false)}
          onConfirm={handleConfirmDownload}
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
