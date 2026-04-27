#!/usr/bin/env bash
# devx supervisor stub — Phase 0 placeholder.
#
# `exec sleep infinity` is intentional and load-bearing: the OS supervisor
# units (launchd KeepAlive=true, systemd Restart=always, Task Scheduler
# RestartOnFailure) hot-restart-loop on a clean exit-0. Sleep-infinity makes
# the unit "running" without restart churn until Phase 1 swaps the body for
# the real `devx --internal manage|concierge` launcher.
#
# Phase 1 will replace this script in place; the unit files stay byte-identical.

role="${1:-manager}"
echo "[devx-${role}] not yet wired ($(date -Iseconds))"
exec sleep infinity
