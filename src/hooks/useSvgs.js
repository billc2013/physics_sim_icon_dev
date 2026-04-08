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
//     id: string,           // schema's `name`, e.g. "wooden_block"
//     label: string,        // schema's `display_name`
//     svg: string,          // schema's `svg_content`
//     status: enum,
//     notes: string,
//     colorTag: string|null, // ramp name, e.g. "blue", or null
//     feedback: [{ text, date }],
//     _uuid: string,        // schema's `id` (UUID), used for writes
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
    _uuid: svgRow.id,
  };
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
  // then runs `dbWrite`. Rolls back on error.
  const optimisticUpdate = useCallback(
    async (id, patch, dbWrite) => {
      const previous = items;
      setItems((prev) =>
        prev ? prev.map((item) => (item.id === id ? { ...item, ...patch } : item)) : prev
      );
      try {
        await dbWrite();
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

  const updateStatus = useCallback(
    async (id, status) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      await optimisticUpdate(id, { status }, async () => {
        const { error: dbError } = await supabase
          .from("physics_svgs")
          .update({ status, updated_by: user.id })
          .eq("id", uuid);
        if (dbError) throw dbError;
      });
    },
    [findUuid, optimisticUpdate, user]
  );

  const updateNotes = useCallback(
    async (id, notes) => {
      const uuid = findUuid(id);
      if (!uuid || !user) return;
      await optimisticUpdate(id, { notes }, async () => {
        const { error: dbError } = await supabase
          .from("physics_svgs")
          .update({ notes, updated_by: user.id })
          .eq("id", uuid);
        if (dbError) throw dbError;
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
        const { error: dbError } = await supabase
          .from("physics_svgs")
          .update({ color_id: colorId, updated_by: user.id })
          .eq("id", uuid);
        if (dbError) throw dbError;
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
            const { error: updateError } = await supabase
              .from("physics_svgs")
              .update({ status: promotedStatus, updated_by: user.id })
              .eq("id", uuid);
            if (updateError) throw updateError;
          }
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
  // DetailModal after the user accepts a revision. The
  // `archive_svg_version` trigger automatically snapshots the prior
  // version into svg_versions and bumps the version number.
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
          const { error: dbError } = await supabase
            .from("physics_svgs")
            .update({
              svg_content: newSvgContent,
              status: promotedStatus,
              updated_by: user.id,
            })
            .eq("id", uuid);
          if (dbError) throw dbError;
        }
      );
    },
    [findUuid, items, optimisticUpdate, user]
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
  };
}
