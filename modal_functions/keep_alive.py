"""
Modal function: keep_alive

Pings the `heartbeat` table in Supabase once a week to prevent the free-tier
project from pausing after 7 days of inactivity. The schema also has a pg_cron
job that does the same thing, but pg_cron can't fire if the project is already
paused — this Modal cron is the external watchdog that prevents that.

SECRETS
-------
Reuses the existing supabase_for_svg_gen Modal secret:
    SUPABASE_DATA_URL, SUPABASE_SERVICE_ROLE_KEY

DEPLOY
------
    modal deploy modal_functions/keep_alive.py

TEST MANUALLY
-------------
    modal run modal_functions/keep_alive.py
"""

import os

import modal

app = modal.App("gist-keep-alive")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "supabase==2.28.3",  # 2.9.1 regex-rejected non-JWT keys; 2.28.x accepts sb_secret_ format
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("supabase_for_svg_gen")],
    schedule=modal.Cron("0 6 * * *"),  # every day at 06:00 UTC
    timeout=30,
)
def keep_alive():
    """
    Update the heartbeat singleton row to now(). This counts as DB activity
    and resets the Supabase free-tier inactivity timer.
    """
    from supabase import create_client

    client = create_client(
        os.environ["SUPABASE_DATA_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    result = (
        client.from_("heartbeat")
        .update({"last_ping": "now()"})
        .eq("id", 1)
        .execute()
    )

    row = result.data[0] if result.data else {}
    print(f"keep_alive: heartbeat pinged. last_ping = {row.get('last_ping', '?')}")
    return {"status": "ok", "last_ping": row.get("last_ping")}


@app.local_entrypoint()
def main():
    """
    Manual test:  modal run modal_functions/keep_alive.py
    """
    result = keep_alive.remote()
    print(result)
