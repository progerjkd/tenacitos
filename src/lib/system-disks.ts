export interface DiskEntry {
  source?: string;
  mountpoint: string;
  fstype?: string;
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface DiskGroup extends DiskEntry {
  mountpoints: string[];
}

const EXCLUDE_FS = /^(tmpfs|devtmpfs|squashfs|sysfs|proc|devpts|cgroup|cgroup2|pstore|securityfs|efivarfs|hugetlbfs|mqueue|binfmt_misc|fusectl|configfs|ramfs|udev|sunrpc|autofs|nsfs|tracefs|debugfs|bpf)$/i;
const EXCLUDE_MOUNT = /^(\/dev|\/sys|\/proc|\/run\/|\/snap\/)/;
const EXCLUDE_FILE_MOUNT = /^\/etc\/(?:hosts|hostname|resolv\.conf)$/;

function roundGb(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseSizeToGb(raw: string): number {
  const match = raw.trim().match(/^([\d.]+)([KMGTPE]?)(?:i?B?)?$/i);
  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;

  switch (match[2].toUpperCase()) {
    case "K":
      return roundGb(value / 1024 / 1024);
    case "M":
      return roundGb(value / 1024);
    case "T":
      return roundGb(value * 1024);
    case "P":
      return roundGb(value * 1024 * 1024);
    case "E":
      return roundGb(value * 1024 * 1024 * 1024);
    case "G":
    default:
      return roundGb(value);
  }
}

function shouldIncludeDisk(mountpoint: string, fstype: string, total: number): boolean {
  if (!mountpoint || EXCLUDE_FS.test(fstype) || EXCLUDE_MOUNT.test(mountpoint) || EXCLUDE_FILE_MOUNT.test(mountpoint)) return false;
  return total > 0;
}

function normalizeDiskSource(source?: string): string | undefined {
  return source?.replace(/\[[^\]]+\]$/, "");
}

export function parseFindmntDisks(output: string): DiskEntry[] {
  const disks: DiskEntry[] = [];

  for (const line of output.trim().split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;

    const [source, mountpoint, fstype, sizeRaw, usedRaw, availRaw, pctRaw] = parts;
    const total = parseSizeToGb(sizeRaw);
    if (!shouldIncludeDisk(mountpoint, fstype, total)) continue;

    disks.push({
      source,
      mountpoint,
      fstype,
      total,
      used: parseSizeToGb(usedRaw),
      free: parseSizeToGb(availRaw),
      percent: Number.parseInt(pctRaw.replace("%", ""), 10) || 0,
    });
  }

  return disks;
}

export function groupDiskEntries(disks: DiskEntry[]): DiskGroup[] {
  const groups = new Map<string, DiskGroup>();

  for (const disk of disks) {
    const source = normalizeDiskSource(disk.source);
    const key = source ? `${source}:${disk.fstype ?? ""}` : `${disk.mountpoint}:${disk.total}:${disk.used}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        ...disk,
        source,
        mountpoints: [disk.mountpoint],
      });
      continue;
    }

    if (!existing.mountpoints.includes(disk.mountpoint)) {
      existing.mountpoints.push(disk.mountpoint);
    }

    const existingDepth = existing.mountpoint.split("/").filter(Boolean).length;
    const diskDepth = disk.mountpoint.split("/").filter(Boolean).length;
    if (diskDepth < existingDepth) {
      existing.mountpoint = disk.mountpoint;
    }
  }

  return Array.from(groups.values());
}

export function parseDfDisks(output: string): DiskEntry[] {
  const disks: DiskEntry[] = [];

  for (const line of output.trim().split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;

    const [source, sizeRaw, usedRaw, availRaw, pctRaw, fstype, mountpoint] = parts;
    const total = parseSizeToGb(sizeRaw);
    if (!shouldIncludeDisk(mountpoint, fstype, total)) continue;

    disks.push({
      source,
      mountpoint,
      fstype,
      total,
      used: parseSizeToGb(usedRaw),
      free: parseSizeToGb(availRaw),
      percent: Number.parseInt(pctRaw.replace("%", ""), 10) || 0,
    });
  }

  return disks;
}
