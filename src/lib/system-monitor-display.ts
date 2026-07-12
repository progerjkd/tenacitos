export interface DiskDisplayInput {
  source?: string;
  fstype?: string;
  mountpoint: string;
}

export interface SwapDisplay {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export function getDiskDisplayDetails(disk: DiskDisplayInput) {
  return {
    device: disk.source ?? "Unknown device",
    filesystem: disk.fstype ?? "Unknown filesystem",
    mountpoint: disk.mountpoint,
  };
}

export function getSwapDisplay(swap?: SwapDisplay): SwapDisplay {
  return swap ?? { total: 0, used: 0, free: 0, percent: 0 };
}
