// One-shot seed script. Inserts the 50 SVGs from src/lib/seedData.js into
// physics_svgs. Idempotent: rows whose `name` already exists are skipped.
//
// Run from the project root with the service role key set inline so it
// never lives on disk:
//
//   SUPABASE_URL=https://xxxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   BILL_USER_ID=00000000-0000-0000-0000-000000000000 \
//   node scripts/seed.js
//
// BILL_USER_ID is the auth.users.id of the user who should own the seeded
// rows (created_by). Grab it from the Supabase Auth dashboard after you
// sign up via the app's login screen.
//
// PREREQUISITE: Bill must already exist in `project_members` (run the
// bootstrap SQL snippet first — see Task 3 instructions).

import { createClient } from "@supabase/supabase-js";
import { SVG_DATA } from "../src/lib/seedData.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BILL_USER_ID = process.env.BILL_USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BILL_USER_ID) {
  console.error(
    "Missing required env vars. Run with:\n" +
      "  SUPABASE_URL=... \\\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=... \\\n" +
      "  BILL_USER_ID=... \\\n" +
      "  node scripts/seed.js"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Sanity-check the bootstrap row exists.
  const { data: memberRow, error: memberError } = await supabase
    .from("project_members")
    .select("user_id, display_name, role")
    .eq("user_id", BILL_USER_ID)
    .maybeSingle();
  if (memberError) {
    console.error("Failed to read project_members:", memberError.message);
    process.exit(1);
  }
  if (!memberRow) {
    console.error(
      `BILL_USER_ID=${BILL_USER_ID} is not in project_members.\n` +
        "Run the bootstrap SQL snippet in the Supabase SQL editor first:\n\n" +
        `  insert into public.project_members (user_id, display_name, role)\n` +
        `  values ('${BILL_USER_ID}', 'Bill', 'owner');`
    );
    process.exit(1);
  }
  console.log(`Bootstrap OK: ${memberRow.display_name} (${memberRow.role})`);

  // 2. Find which names already exist so we can skip them.
  const allNames = Object.keys(SVG_DATA);
  const { data: existing, error: existingError } = await supabase
    .from("physics_svgs")
    .select("name")
    .in("name", allNames);
  if (existingError) {
    console.error("Failed to read existing physics_svgs:", existingError.message);
    process.exit(1);
  }
  const existingSet = new Set((existing ?? []).map((row) => row.name));
  const toInsert = allNames.filter((name) => !existingSet.has(name));

  if (toInsert.length === 0) {
    console.log(`Nothing to do: all ${allNames.length} SVGs already in the database.`);
    return;
  }

  console.log(
    `Inserting ${toInsert.length} new SVGs (${existingSet.size} already exist).`
  );

  // 3. Build the rows. category_id is left NULL; you can tag categories
  //    later in the UI or via the SQL editor.
  const rows = toInsert.map((name) => ({
    name,
    display_name: name.replace(/_/g, " "),
    svg_content: SVG_DATA[name],
    status: "draft",
    notes: "",
    created_by: BILL_USER_ID,
    updated_by: BILL_USER_ID,
  }));

  // 4. Insert in chunks of 50 (the seed is exactly 50, so this is one
  //    call, but the chunking pattern is here for future safety).
  const CHUNK_SIZE = 50;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error: insertError } = await supabase.from("physics_svgs").insert(chunk);
    if (insertError) {
      console.error(`Insert failed on chunk ${i / CHUNK_SIZE + 1}:`, insertError.message);
      process.exit(1);
    }
  }

  console.log(`Done. Inserted ${rows.length} SVGs.`);
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
