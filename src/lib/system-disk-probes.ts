export interface SystemDiskProbe {
  path: string;
  mountpoint: string;
}

export function getSystemDiskProbeArgs(paths: string[]): string[] {
  return ["-hT", "--", ...paths];
}

interface DiskEntry {
  mountpoint: string;
}

export function remapSystemDiskMountpoint<T extends DiskEntry>(disk: T, probes: SystemDiskProbe[]): T {
  const probe = probes.find(({ path }) => disk.mountpoint === path || disk.mountpoint.startsWith(`${path}/`));
  return probe ? { ...disk, mountpoint: probe.mountpoint } : disk;
}
