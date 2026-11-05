"""Create a fresh local SQLite database with the historical 0001–0016 SQL.

This never connects to production. SQLite is a useful migration check, but a
Cloudflare D1 deployment and application workflow still need separate checks.
"""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
files = sorted((root / "migrations").glob("*.sql"))
assert len(files) == 16, "Expected complete historical migration set 0001–0016"
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
db.execute("""INSERT INTO admin_accounts(id,site_id,username,display_name,role,password_salt,password_hash,password_iterations,created_at,updated_at,router_scope_mode)
VALUES ('staff-1','openwifi-main','staff1','Staff 1','operator','salt','hash',100000,1,1,'selected')""")
db.execute("INSERT INTO admin_router_permissions(account_id,router_id,can_view,can_edit) VALUES ('staff-1','router-1',1,0)")
assert db.execute("SELECT router_scope_mode FROM admin_accounts WHERE id='staff-1'").fetchone()[0] == "selected"
db.execute("""INSERT INTO router_telemetry_samples
  (site_id,router_id,minute_bucket,received_at,cpu_load_pct,free_memory_bytes,total_memory_bytes,hotspot_host_count)
  VALUES ('openwifi-main','router-1',1,60000,20,100,200,2)""")
try:
    db.execute("""INSERT INTO router_telemetry_samples
      (site_id,router_id,minute_bucket,received_at,cpu_load_pct)
      VALUES ('openwifi-main','router-1',1,60001,30)""")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Duplicate telemetry minute was allowed")
assert db.execute("SELECT cpu_load_pct FROM router_telemetry_samples WHERE router_id='router-1'").fetchone()[0] == 20
db.execute("""INSERT INTO smartnet_policies(id,site_id,router_id,mode,profile,site_down_kbps,site_up_kbps,updated_at)
VALUES ('policy-1','openwifi-main','router-1','observe','standard',0,0,1)""")
db.execute("""INSERT INTO smartnet_policy_versions(policy_id,revision,snapshot_json,actor,created_at)
VALUES ('policy-1',1,'{}','test',1)""")
db.execute("""INSERT INTO smartnet_cluster_members(router_id,site_id,sector,updated_at)
VALUES ('router-1','openwifi-main','test-sector',1)""")
try:
    db.execute("UPDATE router_devices SET max_client_down_kbps=-1 WHERE id='router-1'")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Invalid router speed preset was allowed")
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
