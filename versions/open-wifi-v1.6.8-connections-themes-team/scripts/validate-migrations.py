"""Create a fresh local SQLite database with the historical 0001–0013 SQL.

This never connects to production. SQLite is a useful migration check, but a
Cloudflare D1 deployment and application workflow still need separate checks.
"""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
files = sorted((root / "migrations").glob("*.sql"))
assert len(files) == 13, "Expected complete historical migration set 0001–0013"
assert files[0].name == "0001_initial.sql"
assert files[1].name == "0002_seed_default.sql"

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for file in files:
    try:
        db.executescript(file.read_text(encoding="utf-8-sig"))
    except sqlite3.Error as error:
        raise RuntimeError(f"Migration {file.name} failed on a fresh database: {error}") from error

assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not db.execute("PRAGMA foreign_key_check").fetchall()
assert db.execute("SELECT COUNT(*) FROM sites WHERE id='openwifi-main'").fetchone()[0] == 1
assert db.execute("SELECT COUNT(*) FROM plans WHERE site_id='openwifi-main'").fetchone()[0] >= 1

db.execute("INSERT INTO devices(id,site_id,created_at,updated_at) VALUES ('test-device','openwifi-main',1,1)")
db.execute("""INSERT INTO payments(id,site_id,device_id,plan_id,amount_cents,created_at,updated_at)
              VALUES ('test-payment','openwifi-main','test-device','plan-standard-1h',200,1,1)""")
attempt = """INSERT INTO access_attempts
(id,site_id,device_id,payment_id,mac,attempt_number,starts_at,ends_at,status,created_at,updated_at)
VALUES (?,'openwifi-main','test-device','test-payment','00:11:22:33:44:55',1,1,2,?,1,1)"""
db.execute(attempt, ("first", "active"))
try:
    db.execute(attempt, ("duplicate", "active"))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Duplicate active attempt was allowed")
db.execute(attempt, ("historical", "expired"))

router = """INSERT INTO router_devices
(id,site_id,name,token_hash,install_mode,enrolled_at,created_at,updated_at)
VALUES (?,'openwifi-main','Test router',?,?,1,1,1)"""
db.execute(router, ("router-1", "test-hash", "agent"))
for args in [("router-2", "test-hash", "agent"), ("router-3", "other-hash", "invalid")]:
    try:
        db.execute(router, args)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Router token/mode constraint was not enforced")
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print(f"{len(files)} migrations executed on a fresh local SQLite database; integrity, seed, foreign keys and constraints passed.")
print("LIMIT: Cloudflare D1 remote deployment and live application workflows were not tested.")
