// Computation progress only: it never means a file has been written to disk.
export type ArchiveProgress = (percent:number) => void;
