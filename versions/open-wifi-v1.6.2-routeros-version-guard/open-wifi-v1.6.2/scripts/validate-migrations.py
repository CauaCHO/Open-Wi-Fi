"""Exercise the supplied upgrade SQL on an explicitly INFERRED minimal fixture.

Migrations 0001/0002 and the original schema are not present in this upgrade.
This checks SQL execution/constraints in SQLite, not fresh D1 installation or
compatibility with a production database. It never connects to production.
"""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
files = sorted((root / "migrations").glob("*.sql"))
assert files, "No migrations found"

# Only pre-existing tables/columns referenced by the supplied migrations.
# Deliberately not a replacement for the missing original schema.
fixture = """
CREATE TABLE sites(id TEXT PRIMARY KEY);
CREATE TABLE devices(id TEXT PRIMARY KEY, site_id TEXT, updated_at INTEGER);
CREATE TABLE events(id TEXT PRIMARY KEY);
CREATE TABLE plans(id TEXT PRIMARY KEY);
CREATE TABLE device_macs(site_id TEXT, device_id TEXT);
CREATE TABLE access_grants(site_id TEXT, device_id TEXT, status TEXT, ends_at INTEGER, payment_id TEXT);
CREATE TABLE payments(id TEXT PRIMARY KEY, mp_order_id TEXT, site_id TEXT, device_id TEXT, plan_id TEXT, status TEXT, created_at INTEGER);
CREATE TABLE party_groups(payment_id TEXT);
CREATE TABLE router_hosts(site_id TEXT, last_seen_at INTEGER);
"""

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(fixture)
for file in files:
    try:
        db.executescript(file.read_text(encoding="utf-8-sig"))
    except sqlite3.Error as error:
        raise RuntimeError(f"Migration {file.name} failed on inferred fixture: {error}") from error
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not db.execute("PRAGMA foreign_key_check").fetchall()

db.execute("INSERT INTO sites(id) VALUES ('test-site')")
db.execute("INSERT INTO devices(id,site_id) VALUES ('test-device','test-site')")
db.execute("INSERT INTO payments(id) VALUES ('test-payment')")
attempt = """INSERT INTO access_attempts
(id,site_id,device_id,payment_id,mac,attempt_number,starts_at,ends_at,status,created_at,updated_at)
VALUES (?,'test-site','test-device','test-payment','00:11:22:33:44:55',1,1,2,?,1,1)"""
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
VALUES (?,'test-site','Test router',?,?,1,1,1)"""
db.execute(router, ("router-1", "test-hash", "agent"))
for args in [("router-2", "test-hash", "agent"), ("router-3", "other-hash", "invalid")]:
    try:
        db.execute(router, args)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Router token/mode constraint was not enforced")
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print(f"{len(files)} upgrade migrations executed on INFERRED minimal SQLite fixture; integrity, foreign keys, unique active attempt and router constraints passed.")
print("LIMIT: original schema/migrations 0001-0002 are absent; fresh D1 installation and real deployment compatibility were NOT validated.")
