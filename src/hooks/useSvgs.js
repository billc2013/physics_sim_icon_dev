import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase.js";

// useSvgs is the data layer for the SVG library. It:
//
//  1. Loads the `svgs_with_details` view + raw `svg_feedback` rows in
//     parallel and merges them into the artifact-shape `item` objects the
//     React components already know how to render.
//  2. Loads `color_palettes` once so we can map colorTag string names
//     ("blue") to schema UUIDs for writes.
//  3. Exposes optimistic update mutations: status, color, notes, feedback.
//     Each mutation patches local state immediately, then writes to the DB.
//     On DB error we roll back to the snapshot taken before the patch.
//
// Item shape (matches the artifact 1:1, plus private/parenting fields):
//   {
//     id: string,                     // schema's `name`, e.g. "wooden_block"
//     label: string,                  // schema's `display_name`
//     svg: string,                    // schema's `svg_content`
//     status: enum,
//     notes: string,
//     colorTag: string|null,          // ramp name, e.g. "blue", or null
//     feedback: [{ text, date }],
//     version: int,                   // physics_svgs.version
//     createdAt: string|null,         // ISO timestamp of creation
//     updatedAt: string|null,         // ISO timestamp of the last update
//     lastExportedAt: string|null,    // ISO timestamp or null
//     lastExportedVersion: int|null,  // version at time of last export
//     lastExportedByName: string|null,// display name of last exporter
//     physicalProperties: object|null,// own physical_properties (null for children)
//     deletedAt: string|null,         // ISO timestamp if trashed, else null
//     deletedByName: string|null,     // display name of who trashed it
//     parentId: string|null,          // parent's `name` (item.id), null if root/standalone
//     _parentUuid: string|null,       // parent's UUID, for writes
//     _uuid: string,                  // schema's `id` (UUID), used for writes
//
//     -- Computed after shaping (by addVariantInfo):
//     variants: [{ id, colorTag }],   // children of this item (empty if not a parent)
//     effectivePhysicalProperties: object|null, // inherited from parent if child, own if root
//   }

function shapeItem(svgRow, feedbackRows) {
  return {
    id: svgRow.name,
    label: svgRow.display_name,
    svg: svgRow.svg_content,
    status: svgRow.status,
    notes: svgRow.notes ?? "",
    colorTag: svgRow.color_name ?? null,
    feedback: feedbackRows
      .filter((f) => f.svg_id === svgRow.id)
      .map((f) => ({ text: f.body, date: f.created_at })),
    version: svgRow.version,
    createdAt: svgRow.created_at ?? null,
    updatedAt: svgRow.updated_at ?? null,
    lastExportedAt: svgRow.last_exported_at ?? null,
    lastExportedVersion: svgRow.last_exported_version ?? null,
    lastExportedByName: svgRow.last_exported_by_name ?? null,
    physicalProperties: svgRow.physical_properties ?? null,
    deletedAt: svgRow.deleted_at ?? null,
    deletedByName: svgRow.deleted_by_name ?? null,
    parentId: svgRow.parent_name ?? null,
    _parentUuid: svgRow.parent_id ?? null,
    _uuid: svgRow.id,
    // Populated by addVariantInfo after all items are shaped:
    variants: [],
    effectivePhysicalProperties: null,
  };
}

// After shaping all items, compute variant relationships and resolve
// physical_properties inheritance. Children always inherit from their
// parent (the "always inherit" rule).
function addVariantInfo(items) {
  const byUuid = new Map(items.map((i) => [i._uuid, i]));
  for (const item of items) {
    if (item._parentUuid) {
      const parent = byUuid.get(item._parentUuid);
      if (parent) {
        parent.variants.push({ id: item.id, colorTag: item.colorTag });
        item.effectivePhysicalProperties = parent.physicalProperties;
      } else {
        // Orphan — parent row was deleted. Fall back to own properties.
        item.effectivePhysicalProperties = item.physicalProperties;
      }
    } else {
      item.effectivePhysicalProperties = item.physicalProperties;
    }
  }
  return items;
}

// ---- Stale-export predicates ----
//
// The three sites that care about "has this changed since last export?" —
// SvgCard's dot, DetailModal's "(changes since)" suffix, and
// DownloadApprovedModal's "new or updated" scope filter — all need to use
// the same definition or users get confused. These helpers are the single
// source of truth.
//
// We compare updatedAt vs lastExportedAt rather than version vs
// lastExportedVersion because the archive-version trigger only fires on
// svg_content/status changes — a color or physical_properties change bumps
// updated_at (via moddatetime) but NOT version, and we want those to count
// as "needs re-export" because they change manifest.json.
//
// Server-side invariant: after the mark_svgs_exported RPC runs, updated_at
// and last_exported_at are set to the same transaction-local now() value,
// so they compare as exactly equal and isStale returns false.

// True when an item has been exported at least once AND has changed since.
export function isStale(item) {
  if (item.lastExportedAt == null) return false;
  if (item.updatedAt == null) return false;
  return new Date(item.updatedAt) > new Date(item.lastExportedAt);
}

// True when an item should be in the "new or updated" export scope:
// either never exported, or stale.
export function needsExport(item) {
  return item.lastExportedAt == null || isStale(item);
}

export function useSvgs(user) {
  const [items, setItems] = useState(null);
  // Trashed (soft-deleted) items live in a separate list. They're excluded
  // from `items` so every existing consumer (grid, export, collision checks,
  // variant inheritance) keeps seeing only active rows. The TrashPanel reads
  // this list. Rows here may share a `name` with each other or with an active
  // item, so anything keying off trashed rows MUST use `_uuid`, not `id`.
  const [trashedItems, setTrashedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cached map: ramp name -> palette uuid. Loaded once on first refresh.
  const paletteIdByNameRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [svgsResult, feedbackResult, palettesResult] = await Promise.all([
        supabase.from("svgs_with_details").select("*").order("display_name"),
        supabase.from("svg_feedback").select("id, svg_id, body, created_at").order("created_at"),
        // Cache palette ids on the first load. Cheap and rarely changes.
        paletteIdByNameRef.current
          ? Promise.resolve({ data: null, error: null })
          : supabase.from("color_palettes").select("id, name"),
      ]);
      if (svgsResult.error) throw svgsResult.error;
      if (feedbackResult.error) throw feedbackResult.error;
      if (palettesResult.error) throw palettesResult.error;

      if (palettesResult.data) {
        paletteIdByNameRef.current = Object.fromEntries(
          palettesResult.data.map((row) => [row.name, row.id])
        );
      }

      const shaped = svgsResult.data.map((row) => shapeItem(row, feedbackResult.data));
      // Split active vs trashed. Variant inheritance is computed over the
      // ACTIVE set only — a trashed parent shouldn't feed properties to a
      // live child (and vice versa). Trashed rows keep their basic shape.
      const active = shaped.filter((it) => it.deletedAt == null);
      const trashed = shaped
        .filter((it) => it.deletedAt != null)
        .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
      setItems(addVariantInfo(active));
      setTrashedItems(trashed);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Refresh whenever the user changes (login/logout).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optimistic patch helper: applies `patch` to the matching item locally,
  // then runs `dbWrite`. If `dbWrite` returns an object, that object is
  // merged into the item AFTER the write succeeds — useful for patching
  // server-assigned fields like `version` (bumped by the archive trigger)
  // and `updatedAt` (set by moddatetime) back into local state without
  // needing a full refresh. Rolls back to the snapshot on error.
  const optimisticUpdate = useCallback(
    async (id, patch, dbWrite) => {
      const previous = items;
      setItems((prev) =>
        prev ? prev.map((item) => (item.id === id ? { ...item, ...patch } : item)) : prev
      );
      try {
        const postPatch = await dbWrite();
        if (postPatch) {
          setItems((prev) =>
            prev
              ? prev.map((item) => (item.id === id ? { ...item, ...postPatch } : item))
              : prev
          );
        }
      } catch (e) {
        setItems(previous);
        throw e;
      }
    },
    [items]
  );

  const findUuid = useCallback(
    (id) => items?.find((item) => item.id === id)?._uuid ?? null,
    [items]
  );

  // Mutations that touch physics_svgs all use `.select("version, updated_at")
  // .single()` so the server-authoritative version and updated_at flow back
  // into local state. Without this, the stale-check (updatedAt >
  // lastExportedAt) would be computed against a stale local updatedAt and
  // miss recent changes until the next refresh().
  const SVG_RETURN_COLS = "version, updated_at";
  const toPostPatch = (row) => ({ version: row.version, updatedAt: row.updated_at });

  const updateStatus = useCallback(
    async (id, status) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      await optimisticUpdate(id, { status }, async () => {
        const { data, error: dbError } = await supabase
          .from("physics_svgs")
          .update({ status, updated_by: user.id })
          .eq("id", uuid)
          .select(SVG_RETURN_COLS)
          .single();
        if (dbError) throw dbError;
        return toPostPatch(data);
      });
    },
    [findUuid, optimisticUpdate, user]
  );

  const updateNotes = useCallback(
    async (id, notes) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      await optimisticUpdate(id, { notes }, async () => {
        const { data, error: dbError } = await supabase
          .from("physics_svgs")
          .update({ notes, updated_by: user.id })
          .eq("id", uuid)
          .select(SVG_RETURN_COLS)
          .single();
        if (dbError) throw dbError;
        return toPostPatch(data);
      });
    },
    [findUuid, optimisticUpdate, user]
  );

  const updateColor = useCallback(
    async (id, colorTag) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      const colorId = colorTag ? paletteIdByNameRef.current?.[colorTag] ?? null : null;
      await optimisticUpdate(id, { colorTag }, async () => {
        const { data, error: dbError } = await supabase
          .from("physics_svgs")
          .update({ color_id: colorId, updated_by: user.id })
          .eq("id", uuid)
          .select(SVG_RETURN_COLS)
          .single();
        if (dbError) throw dbError;
        return toPostPatch(data);
      });
    },
    [findUuid, optimisticUpdate, user]
  );

  // Adding feedback to a draft auto-promotes it to "revised". Other statuses
  // keep their existing status. We do this in two writes (insert feedback,
  // then update status if needed) since they touch different tables.
  const addFeedback = useCallback(
    async (id, text) => {
      const uuid = findUuid(id);
      if (!uuid || !user || !text.trim()) return;
      const trimmedText = text.trim();
      const entry = { text: trimmedText, date: new Date().toISOString() };
      const item = items.find((i) => i.id === id);
      const promotedStatus = item.status === "draft" ? "revised" : item.status;

      await optimisticUpdate(
        id,
        {
          feedback: [...item.feedback, entry],
          status: promotedStatus,
        },
        async () => {
          const { error: insertError } = await supabase
            .from("svg_feedback")
            .insert({ svg_id: uuid, author_id: user.id, body: trimmedText });
          if (insertError) throw insertError;

          if (promotedStatus !== item.status) {
            // Promotion branch: this UPDATE bumps version via the archive
            // trigger AND updated_at via moddatetime. Return both so the
            // local state reflects the new values and the stale-check
            // against last_exported_at is correct without a refresh.
            const { data, error: updateError } = await supabase
              .from("physics_svgs")
              .update({ status: promotedStatus, updated_by: user.id })
              .eq("id", uuid)
              .select(SVG_RETURN_COLS)
              .single();
            if (updateError) throw updateError;
            return toPostPatch(data);
          }
          // Non-promotion branch: feedback insert only, no physics_svgs
          // UPDATE, no updated_at bump. This is correct — feedback isn't in
          // the manifest, so feedback-only changes should NOT mark stale.
          return undefined;
        }
      );
    },
    [findUuid, items, optimisticUpdate, user]
  );

  // Insert a brand-new SVG into the library. Used by Flow A
  // (GenerateNewModal), Flow C (batch category), and Flow D (color
  // variants — each variant is inserted as a separate item with name
  // `{color}_{objectName}`). Optional `colorTag` sets the color palette
  // on insert so we don't need a separate updateColor call. Optional
  // `parentUuid` links the new item as a color variant of an existing
  // parent (Flow D). Returns the inserted item id (the schema's `name`)
  // on success.
  const insertSvg = useCallback(
    async ({ name, displayName, svgContent, colorTag, parentUuid, physicalProperties }) => {
      if (!user) return null;
      const colorId = colorTag
        ? paletteIdByNameRef.current?.[colorTag] ?? null
        : null;
      const row = {
        name,
        display_name: displayName,
        svg_content: svgContent,
        status: "draft",
        notes: "",
        color_id: colorId,
        created_by: user.id,
        updated_by: user.id,
      };
      if (parentUuid) row.parent_id = parentUuid;
      if (physicalProperties) row.physical_properties = physicalProperties;
      const { error: dbError } = await supabase.from("physics_svgs").insert(row);
      if (dbError) throw dbError;
      // Reload so the new row appears in the grid.
      await refresh();
      return name;
    },
    [refresh, user]
  );

  // Replace the SVG markup of an existing item. Used by Flow B in
  // DetailModal after the user accepts a revision, and by the manual
  // upload flow in DetailModal after the user accepts a local edit. The
  // `archive_svg_version` trigger automatically snapshots the prior
  // version into svg_versions and bumps the version number — we return
  // the bumped `version` and the fresh `updated_at` from the server so
  // the local stale-check works immediately without a refresh.
  //
  // Promotes draft -> revised so the badge reflects the change.
  const updateSvgContent = useCallback(
    async (id, newSvgContent) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      const item = items?.find((i) => i.id === id);
      if (!item) return;
      const promotedStatus = item.status === "draft" ? "revised" : item.status;

      await optimisticUpdate(
        id,
        { svg: newSvgContent, status: promotedStatus },
        async () => {
          const { data, error: dbError } = await supabase
            .from("physics_svgs")
            .update({
              svg_content: newSvgContent,
              status: promotedStatus,
              updated_by: user.id,
            })
            .eq("id", uuid)
            .select(SVG_RETURN_COLS)
            .single();
          if (dbError) throw dbError;
          return toPostPatch(data);
        }
      );
    },
    [findUuid, items, optimisticUpdate, user]
  );

  // Stamp a batch of items as "exported right now" after a successful zip
  // download. Calls the server-side `mark_svgs_exported` RPC (see schema
  // migration 11b) so that `updated_at` and `last_exported_at` end up
  // set to the same transaction-local now() value and the stale-check
  // (`updatedAt > lastExportedAt`) resolves to "not stale" for the
  // just-exported rows. A client-side UPDATE can't guarantee this
  // because moddatetime bumps updated_at to server's now() and that
  // diverges from any client-supplied last_exported_at ISO string.
  //
  // Optimistic local patch uses a client-side ISO string for BOTH fields
  // (so they're locally equal and not-stale), and will self-correct to
  // the real server timestamps on the next refresh().
  const markExported = useCallback(
    async (uuids) => {
      if (!user || !items || !uuids || uuids.length === 0) return;
      const nowIso = new Date().toISOString();
      const previous = items;
      setItems((prev) =>
        prev?.map((item) =>
          uuids.includes(item._uuid)
            ? {
                ...item,
                lastExportedAt: nowIso,
                lastExportedVersion: item.version,
                updatedAt: nowIso,
                // lastExportedByName isn't set optimistically — we don't
                // have the display name in hand here. The next refresh
                // will pull it from the view via pm_exported join.
              }
            : item
        ) ?? prev
      );
      try {
        const { error: rpcError } = await supabase.rpc("mark_svgs_exported", {
          svg_ids: uuids,
        });
        if (rpcError) throw rpcError;
      } catch (e) {
        setItems(previous);
        throw e;
      }
    },
    [items, user]
  );

  // Update the free-form physical_properties jsonb column. Used by the
  // collider generator to save computed collider data, and eventually by a
  // physical-properties editor. Merges the patch into the existing value
  // so callers can update individual keys without clobbering others.
  //
  // Because children always inherit physical_properties from their parent,
  // this mutation also updates effectivePhysicalProperties on the target
  // item AND all its children so the UI reflects the change immediately
  // without a full refresh.
  const updatePhysicalProperties = useCallback(
    async (id, patch) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      const item = items?.find((i) => i.id === id);
      if (!item) return;
      const merged = { ...(item.physicalProperties || {}), ...patch };

      // Optimistic update: patch the target item's own + effective props.
      const previous = items;
      setItems((prev) =>
        prev
          ? prev.map((it) => {
              if (it.id === id) {
                // The target item itself.
                return { ...it, physicalProperties: merged, effectivePhysicalProperties: merged };
              }
              if (it._parentUuid === uuid) {
                // A child of the target — inherits effective props.
                return { ...it, effectivePhysicalProperties: merged };
              }
              return it;
            })
          : prev
      );

      try {
        const { data, error: dbError } = await supabase
          .from("physics_svgs")
          .update({ physical_properties: merged, updated_by: user.id })
          .eq("id", uuid)
          .select(SVG_RETURN_COLS)
          .single();
        if (dbError) throw dbError;
        const post = toPostPatch(data);
        // Apply server-returned version/updatedAt to the target item.
        if (post) {
          setItems((prev) =>
            prev ? prev.map((it) => (it.id === id ? { ...it, ...post } : it)) : prev
          );
        }
      } catch (e) {
        setItems(previous);
        throw e;
      }
    },
    [findUuid, items, user]
  );

  // Rename an item: changes both the display label and the underlying
  // `name`/slug (item.id). The slug is load-bearing (React key, generation
  // object_name, zip filename, manifest name), so renaming it ripples — the
  // caller (App) must point the open DetailModal at the returned new id.
  //
  // Collision is checked against ACTIVE names only; trashed rows may keep a
  // colliding name. The DB partial unique index (physics_svgs_name_active_key)
  // is the backstop. Renaming a parent also patches its children's `parentId`
  // (the "↑ parent" label) locally; child ids are unchanged. Returns the new id.
  //
  // DB-first (not optimistic): the slug IS item.id, the React key and the open
  // modal's selector. We write first, then in ONE tick call `onRenamed(newId)`
  // (so the caller can re-point the modal) and patch local state — so there's
  // never a render frame where the modal's id matches no item.
  const renameSvg = useCallback(
    async (id, { name: newName, displayName: newDisplayName }, onRenamed) => {
      const uuid = findUuid(id);
      if (!uuid || !user || !items) return;
      const trimmedName = (newName ?? "").trim();
      const trimmedLabel = (newDisplayName ?? "").trim();
      if (!trimmedName) throw new Error("Name can't be empty.");
      if (
        trimmedName !== id &&
        items.some((it) => it.id === trimmedName && it._uuid !== uuid)
      ) {
        throw new Error(`"${trimmedName}" is already used by an active object.`);
      }
      const { data, error: dbError } = await supabase
        .from("physics_svgs")
        .update({ name: trimmedName, display_name: trimmedLabel, updated_by: user.id })
        .eq("id", uuid)
        .select(SVG_RETURN_COLS)
        .single();
      if (dbError) throw dbError;
      const post = toPostPatch(data);
      onRenamed?.(trimmedName);
      setItems((prev) =>
        prev
          ? prev.map((it) => {
              if (it._uuid === uuid)
                return { ...it, id: trimmedName, label: trimmedLabel, ...post };
              if (it._parentUuid === uuid) return { ...it, parentId: trimmedName };
              return it;
            })
          : prev
      );
      return trimmedName;
    },
    [findUuid, items, user]
  );

  // Move an item to the trash (soft delete). Cascades to color variants: a
  // parent and its children are trashed together in one UPDATE (filtered to
  // currently-active rows). Reloads after so the grid, trash list, and variant
  // inheritance reconcile cleanly.
  const trashSvg = useCallback(
    async (id) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      const nowIso = new Date().toISOString();
      const { error: dbError } = await supabase
        .from("physics_svgs")
        .update({ deleted_at: nowIso, deleted_by: user.id })
        .or(`id.eq.${uuid},parent_id.eq.${uuid}`)
        .is("deleted_at", null);
      if (dbError) throw dbError;
      await refresh();
    },
    [findUuid, refresh, user]
  );

  // Restore a trashed item (and its trashed variants). Keyed by UUID because
  // trashed names can collide. `newName` (optional) renames the primary row on
  // the way out — the caller supplies it when the original name is already
  // taken by an active item (we never auto-suffix; the name is semantic input
  // to the downstream GIST LLM). Throws a clear message if a name still
  // collides so the UI can prompt for a different one.
  const restoreSvg = useCallback(
    async (uuid, newName) => {
      if (!uuid || !user) return;
      const target = trashedItems.find((it) => it._uuid === uuid);
      if (!target) return;
      const finalName = (newName ?? target.id).trim();
      if (!finalName) throw new Error("Name can't be empty.");
      const activeNames = new Set((items ?? []).map((it) => it.id));
      if (activeNames.has(finalName)) {
        throw new Error(
          `"${finalName}" is already taken by an active object — choose a different name.`
        );
      }
      // Pre-check trashed variants that would come back with the parent.
      const childCollisions = trashedItems
        .filter((it) => it._parentUuid === uuid && activeNames.has(it.id))
        .map((it) => it.id);
      if (childCollisions.length) {
        throw new Error(
          `Variant name(s) ${childCollisions.join(", ")} are taken by active objects. ` +
            "Resolve those before restoring this set."
        );
      }
      // Primary row: clear trash + apply optional rename.
      const primaryUpdate = { deleted_at: null, deleted_by: null, updated_by: user.id };
      if (finalName !== target.id) primaryUpdate.name = finalName;
      const { error: primaryError } = await supabase
        .from("physics_svgs")
        .update(primaryUpdate)
        .eq("id", uuid);
      if (primaryError) throw primaryError;
      // Trashed variants (names unchanged).
      const { error: childError } = await supabase
        .from("physics_svgs")
        .update({ deleted_at: null, deleted_by: null, updated_by: user.id })
        .eq("parent_id", uuid)
        .not("deleted_at", "is", null);
      if (childError) throw childError;
      await refresh();
    },
    [items, refresh, trashedItems, user]
  );

  // Permanently delete a trashed item and its trashed variants. Hard DELETE,
  // owner-only (RLS "Owners can delete SVGs"). svg_versions + svg_feedback rows
  // cascade; generation_sessions.svg_id nulls (audit kept). Scoped to trashed
  // rows so a separately-restored child is never caught. Keyed by UUID.
  const deleteSvgPermanently = useCallback(
    async (uuid) => {
      if (!uuid || !user) return;
      const { error: dbError } = await supabase
        .from("physics_svgs")
        .delete()
        .or(`id.eq.${uuid},parent_id.eq.${uuid}`)
        .not("deleted_at", "is", null);
      if (dbError) throw dbError;
      await refresh();
    },
    [refresh, user]
  );

  // Bulk action: promote every draft to idea_only. One UPDATE statement.
  const promoteAllDraftsToIdea = useCallback(async () => {
    if (!user || !items) return;
    const previous = items;
    setItems((prev) =>
      prev.map((item) => (item.status === "draft" ? { ...item, status: "idea_only" } : item))
    );
    try {
      const { error: dbError } = await supabase
        .from("physics_svgs")
        .update({ status: "idea_only", updated_by: user.id })
        .eq("status", "draft");
      if (dbError) throw dbError;
    } catch (e) {
      setItems(previous);
      throw e;
    }
  }, [items, user]);

  return {
    items,
    trashedItems,
    loading,
    error,
    refresh,
    updateStatus,
    updateNotes,
    updateColor,
    addFeedback,
    promoteAllDraftsToIdea,
    insertSvg,
    updateSvgContent,
    updatePhysicalProperties,
    markExported,
    renameSvg,
    trashSvg,
    restoreSvg,
    deleteSvgPermanently,
  };
}
