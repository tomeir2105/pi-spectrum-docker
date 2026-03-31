declare global {
  // eslint-disable-next-line no-var
  var __sdrOwner: string | undefined;
}

export function acquireSdr(owner: string) {
  if (globalThis.__sdrOwner && globalThis.__sdrOwner !== owner) {
    throw new Error(`SDR is busy with ${globalThis.__sdrOwner}. Stop live audio before starting a scan.`);
  }

  globalThis.__sdrOwner = owner;

  return () => {
    if (globalThis.__sdrOwner === owner) {
      globalThis.__sdrOwner = undefined;
    }
  };
}
