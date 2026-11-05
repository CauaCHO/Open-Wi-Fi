-- Read-only counters from the uniquely active default-route interface.
ALTER TABLE router_telemetry_samples ADD COLUMN wan_interface TEXT;
ALTER TABLE router_telemetry_samples ADD COLUMN wan_rx_bytes INTEGER CHECK(wan_rx_bytes >= 0);
ALTER TABLE router_telemetry_samples ADD COLUMN wan_tx_bytes INTEGER CHECK(wan_tx_bytes >= 0);
