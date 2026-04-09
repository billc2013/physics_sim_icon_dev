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
// Item shape (matches the artifact 1:1, plus a private _uuid field):
//   {
//     id: string,                     // schema's `name`, e.g. "wooden_block"
//     label: string,                  // schema's `display_name`
//     svg: string,                    // schema's `svg_content`
//     status: enum,
//     notes: string,
//     colorTag: string|null,          // ramp name, e.g. "blue", or null
//     feedback: [{ text, date }],
//     version: int,                   // physics_svgs.version
//     updatedAt: string|null,         // ISO timestamp of the last update
//     lastExportedAt: string|null,    // ISO timestamp or null
//     lastExportedVersion: int|null,  // version at time of last export
//     lastExportedByName: string|null,// display name of last exporter
//     physicalProperties: object|null,// free-form jsonb (mass_kg etc.)
//     _uuid: string,                  // schema's `id` (UUID), used for writes
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
    updatedAt: svgRow.updated_at ?? null,
    lastExportedAt: svgRow.last_exported_at ?? null,
    lastExportedVersion: svgRow.last_exported_version ?? null,
    lastExportedByName: svgRow.last_exported_by_name ?? null,
    physicalProperties: svgRow.physical_properties ?? null,
    _uuid: svgRow.id,
  };
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
      setItems(shaped);
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

  // Insert a brand-new SVG into the library. Used by Flow A in
  // GenerateNewModal after the user accepts a Claude-generated SVG.
  // Returns the inserted item id (the schema's `name`) on success.
  const insertSvg = useCallback(
    async ({ name, displayName, svgContent }) => {
      if (!user) return null;
      const { error: dbError } = await supabase.from("physics_svgs").insert({
        name,
        display_name: displayName,
        svg_content: svgContent,
        status: "draft",
        notes: "",
        created_by: user.id,
        updated_by: user.id,
      });
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
    markExported,
  };
}
