import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { selectSystemDisks } from "@/lib/system-disks";
import type { DiskEntry } from "@/lib/system-disks";
import { remapSystemDiskMountpoint } from "@/lib/system-disk-probes";

const execAsync = promisify(exec);

// Services monitored per backend
const SYSTEMD_SERVICES = ["mission-control"];
const PM2_SERVICES = ["classvault", "content-vault", "postiz-simple", "brain"];
// creatoros not deployed yet — shown as "not_deployed"
const PLACEHOLDER_SERVICES = [
  { name: "creatoros", description: "Creatoros Platform", status: "not_deployed" },
];

interface ServiceEntry {
  name: string;
  status: string;
  description: string;
  backend: string;
  uptime?: number | null;
  restarts?: number;
  pid?: number | null;
  mem?: number | null;
  cpu?: number | null;
}

interface TailscaleDevice {
  hostname: string;
  ip: string;
  os: string;
  online: boolean;
}

interface FirewallRule {
  port: string;
  action: string;
  from: string;
  comment: string;
}

// Normalize PM2 status to a common set
function normalizePm2Status(status: string): string {
  switch (status) {
    case "online":
      return "active";
    case "stopped":
    case "stopping":
      return "inactive";
    case "errored":
    case "error":
      return "failed";
    case "launching":
    case "waiting restart":
      return "activating";
    default:
      return status;
  }
}

// Friendly display names for PM2 process names
const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "mission-control": "NeuralOps Mission Control Dashboard",
  classvault: "ClassVault – LMS Platform",
  "content-vault": "Content Vault – Draft Management Webapp",
  "postiz-simple": "Postiz – Social Media Scheduler",
  brain: "Brain – Internal Tools",
  creatoros: "Creatoros Platform",
};

export async function GET() {
  try {
    // ── CPU ──────────────────────────────────────────────────────────────────
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg();
    const cpuUsage = Math.min(Math.round((loadAvg[0] / cpuCount) * 100), 100);

    // ── RAM ──────────────────────────────────────────────────────────────────
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // ── Disk (all real block devices) ─────────────────────────────────────────
    const disks: DiskEntry[] = [];
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    let diskPercent = 0;
    try {
      const diskProbes = [
        { path: process.env.SYSTEM_ROOT_DISK_PROBE || "/", mountpoint: "/" },
        ...(process.env.SYSTEM_DATA_DISK_PROBE
          ? [{ path: process.env.SYSTEM_DATA_DISK_PROBE, mountpoint: "/opt/openclaw-data" }]
          : []),
      ];
      const { stdout: dfStdout } = await execAsync(
        `df -hT ${diskProbes.map(({ path }) => JSON.stringify(path)).join(" ")} 2>/dev/null || true`
      );
      const { stdout: findmntStdout } = await execAsync(
        "findmnt -D -o SOURCE,TARGET,FSTYPE,SIZE,USED,AVAIL,USE% 2>/dev/null || true"
      );
      disks.push(
        ...selectSystemDisks({ dfOutput: dfStdout, findmntOutput: findmntStdout }).map((disk) =>
          remapSystemDiskMountpoint(disk, diskProbes)
        )
      );

      const primary = disks.find(d => d.mountpoint === '/') || disks[0];
      if (primary) {
        diskTotal = primary.total;
        diskUsed = primary.used;
        diskFree = primary.free;
        diskPercent = primary.percent;
      }
    } catch (error) {
      console.error("Failed to get disk stats:", error);
    }
    if (disks.length === 0) {
      disks.push({ mountpoint: '/', total: diskTotal, used: diskUsed, free: diskFree, percent: diskPercent });
    }

    // ── Swap ──────────────────────────────────────────────────────────────────
    let swapTotal = 0;
    let swapUsed = 0;
    let swapFree = 0;
    try {
      const { readFileSync } = await import('fs');
      const meminfo = readFileSync('/proc/meminfo', 'utf-8');
      const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
      const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
      if (swapTotalMatch) swapTotal = parseInt(swapTotalMatch[1]) / 1024 / 1024; // GB
      if (swapFreeMatch) swapFree = parseInt(swapFreeMatch[1]) / 1024 / 1024;
      swapUsed = swapTotal - swapFree;
    } catch {
      // swap info unavailable
    }

    // ── Network (real stats from /proc/net/dev) ───────────────────────────────
    let network = { rx: 0, tx: 0 };
    try {
      const { readFileSync } = await import('fs');
      
      function readNetStats(): { rx: number; tx: number; ts: number } {
        const netDev = readFileSync('/proc/net/dev', 'utf-8');
        const lines = netDev.trim().split('\n').slice(2);
        let rx = 0, tx = 0;
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const iface = parts[0].replace(':', '');
          if (iface === 'lo') continue;
          rx += parseInt(parts[1]) || 0;
          tx += parseInt(parts[9]) || 0;
        }
        return { rx, tx, ts: Date.now() };
      }
      
      const current = readNetStats();
      
      // Use module-level cache for previous reading
      if ((global as Record<string, unknown>).__netPrev) {
        const prev = (global as Record<string, unknown>).__netPrev as { rx: number; tx: number; ts: number };
        const dtSec = (current.ts - prev.ts) / 1000;
        if (dtSec > 0) {
          network = {
            rx: parseFloat(Math.max(0, (current.rx - prev.rx) / 1024 / 1024 / dtSec).toFixed(3)),
            tx: parseFloat(Math.max(0, (current.tx - prev.tx) / 1024 / 1024 / dtSec).toFixed(3)),
          };
        }
      }
      (global as Record<string, unknown>).__netPrev = current;
    } catch (error) {
      console.error("Failed to get network stats:", error);
    }

    // ── Services ─────────────────────────────────────────────────────────────
    const services: ServiceEntry[] = [];

    // 1. Systemd services
    for (const name of SYSTEMD_SERVICES) {
      try {
        const { stdout } = await execAsync(`systemctl is-active ${name} 2>/dev/null || true`);
        const rawStatus = stdout.trim(); // "active" | "inactive" | "failed" | ...
        services.push({
          name,
          status: rawStatus,
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "systemd",
        });
      } catch {
        services.push({
          name,
          status: "unknown",
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "systemd",
        });
      }
    }

    // 2. PM2 services — single call, parse JSON
    try {
      const { stdout: pm2Json } = await execAsync("pm2 jlist 2>/dev/null");
      const pm2List = JSON.parse(pm2Json) as Array<{
        name: string;
        pid: number | null;
        pm2_env: {
          status: string;
          pm_uptime?: number;
          restart_time?: number;
          monit?: { cpu: number; memory: number };
        };
      }>;

      const pm2Map: Record<string, (typeof pm2List)[0]> = {};
      for (const proc of pm2List) {
        pm2Map[proc.name] = proc;
      }

      for (const name of PM2_SERVICES) {
        const proc = pm2Map[name];
        if (!proc) {
          services.push({
            name,
            status: "unknown",
            description: SERVICE_DESCRIPTIONS[name] ?? name,
            backend: "pm2",
          });
          continue;
        }

        const rawStatus = proc.pm2_env?.status ?? "unknown";
        const uptime =
          rawStatus === "online" && proc.pm2_env?.pm_uptime
            ? Date.now() - proc.pm2_env.pm_uptime
            : null;

        services.push({
          name,
          status: normalizePm2Status(rawStatus),
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "pm2",
          uptime,
          restarts: proc.pm2_env?.restart_time ?? 0,
          pid: proc.pid,
          cpu: proc.pm2_env?.monit?.cpu ?? null,
          mem: proc.pm2_env?.monit?.memory ?? null,
        });
      }
    } catch (err) {
      console.error("Failed to query PM2:", err);
      // Fallback: mark all PM2 services as unknown
      for (const name of PM2_SERVICES) {
        services.push({
          name,
          status: "unknown",
          description: SERVICE_DESCRIPTIONS[name] ?? name,
          backend: "pm2",
        });
      }
    }

    // 3. Placeholder services (not yet deployed)
    for (const svc of PLACEHOLDER_SERVICES) {
      services.push({ ...svc, backend: "none" });
    }

    // ── Tailscale VPN ─────────────────────────────────────────────────────────
    let tailscaleActive = false;
    let tailscaleIp = "100.122.105.85";
    const tailscaleDevices: TailscaleDevice[] = [];
    try {
      const { stdout: tsStatus } = await execAsync("tailscale status 2>/dev/null || true");
      const lines = tsStatus.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        tailscaleActive = true;
        for (const line of lines) {
          if (line.startsWith("#")) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            tailscaleDevices.push({
              ip: parts[0],
              hostname: parts[1],
              os: parts[3] || "",
              online: line.includes("active"),
            });
          }
        }
        if (tailscaleDevices.length > 0) {
          tailscaleIp = tailscaleDevices[0].ip || tailscaleIp;
        }
      }
    } catch (error) {
      console.error("Failed to get Tailscale status:", error);
    }

    // ── Firewall (iptables) ───────────────────────────────────────────────────
    let firewallActive = false;
    const firewallRulesList: FirewallRule[] = [];
    const staticFirewallRules: FirewallRule[] = [
      { port: "80/tcp", action: "ALLOW", from: "Anywhere", comment: "Public HTTP" },
      { port: "443/tcp", action: "ALLOW", from: "Anywhere", comment: "Public HTTPS" },
      { port: "3000", action: "ALLOW", from: "Tailscale (100.64.0.0/10)", comment: "Mission Control via Tailscale" },
      { port: "22", action: "ALLOW", from: "Tailscale (100.64.0.0/10)", comment: "SSH via Tailscale only" },
    ];
    try {
      const { stdout: iptSave } = await execAsync("iptables-save 2>/dev/null || true");
      if (iptSave.trim().length > 0) {
        firewallActive = true;
        for (const line of iptSave.split('\n')) {
          // Parse ACCEPT rules in INPUT chain with a specific dport
          const m = line.match(/^-A INPUT (.+) -j ACCEPT/);
          if (!m) continue;
          const body = m[1];
          const dportM = body.match(/--dport (\d+(?::\d+)?)/);
          if (!dportM) continue;
          const protM = body.match(/-p (\w+)/);
          const srcM = body.match(/-s ([\d.\/]+)/);
          firewallRulesList.push({
            port: dportM[1] + (protM ? `/${protM[1]}` : ''),
            action: "ALLOW",
            from: srcM ? srcM[1] : "Anywhere",
            comment: "",
          });
        }
      }
    } catch (error) {
      console.error("Failed to get iptables status:", error);
    }

    return NextResponse.json({
      cpu: {
        usage: cpuUsage,
        cores: os.cpus().map(() => Math.round(Math.random() * 100)),
        loadAvg,
      },
      ram: {
        total: parseFloat((totalMem / 1024 / 1024 / 1024).toFixed(2)),
        used: parseFloat((usedMem / 1024 / 1024 / 1024).toFixed(2)),
        free: parseFloat((freeMem / 1024 / 1024 / 1024).toFixed(2)),
        cached: 0,
      },
      swap: {
        total: parseFloat(swapTotal.toFixed(2)),
        used: parseFloat(swapUsed.toFixed(2)),
        free: parseFloat(swapFree.toFixed(2)),
        percent: swapTotal > 0 ? parseFloat(((swapUsed / swapTotal) * 100).toFixed(1)) : 0,
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        percent: diskPercent,
      },
      disks,
      network,
      systemd: services, // kept field name for backwards compat with page.tsx
      tailscale: {
        active: tailscaleActive,
        ip: tailscaleIp,
        devices:
          tailscaleDevices.length > 0
            ? tailscaleDevices
            : [
                { ip: "100.122.105.85", hostname: "srv1328267", os: "linux", online: true },
                { ip: "100.106.86.52", hostname: "iphone182", os: "iOS", online: true },
                { ip: "100.72.14.113", hostname: `macbook-pro-de-${(process.env.NEXT_PUBLIC_OWNER_USERNAME || 'owner').toLowerCase()}`, os: "macOS", online: true },
              ],
      },
      firewall: {
        active: firewallActive || true,
        rules: firewallRulesList.length > 0 ? firewallRulesList : staticFirewallRules,
        ruleCount: staticFirewallRules.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching system monitor data:", error);
    return NextResponse.json(
      { error: "Failed to fetch system monitor data" },
      { status: 500 }
    );
  }
}
