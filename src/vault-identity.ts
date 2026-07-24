const IDENTITY_FILE = "vault-id.json";
const PROTOTYPE_MARKER = "PALIMPSEST_INDEXEDDB_VALIDATION_PROTOTYPE_DO_NOT_USE_FOR_PRODUCTION";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The minimal subset of Obsidian's DataAdapter needed for the vault identity file. */
export interface VaultIdentityDataAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  /** Obsidian's public atomic read-modify-write operation. */
  process(path: string, fn: (data: string) => string): Promise<string>;
}

export interface VaultIdentityOptions {
  configDir: string;
  adapter: VaultIdentityDataAdapter;
  /** Test seam; production uses the platform UUID generator. */
  createUuid?(): string;
}

export interface VaultIdentity {
  vaultId: string;
  created: boolean;
  absorbedPrototypeMarker: boolean;
}

interface IdentityFile {
  schemaVersion: 1;
  vaultId: string;
  prototypeMarker?: string;
}

const initializationFlights = new WeakMap<object, Map<string, Promise<VaultIdentity>>>();

/** Reads or creates the stable identity outside the plugin Junction directory. */
export async function ensureVaultIdentity(options: VaultIdentityOptions): Promise<VaultIdentity> {
  const path = joinVaultPath(joinVaultPath(options.configDir, "palimpsest"), IDENTITY_FILE);
  let flights = initializationFlights.get(options.adapter);
  if (!flights) {
    flights = new Map();
    initializationFlights.set(options.adapter, flights);
  }
  const existing = flights.get(path);
  if (existing) return existing;
  const initialization = ensureVaultIdentityOnce(options, path).finally(() => flights?.delete(path));
  flights.set(path, initialization);
  return initialization;
}

async function ensureVaultIdentityOnce(options: VaultIdentityOptions, path: string): Promise<VaultIdentity> {
  const directory = joinVaultPath(options.configDir, "palimpsest");
  const { adapter } = options;
  if (!await adapter.exists(path)) {
    if (!await adapter.exists(directory)) await adapter.mkdir(directory);
    const vaultId = (options.createUuid ?? (() => crypto.randomUUID()))();
    if (!isUuid(vaultId)) throw new Error("Vault identity generator returned an invalid UUID");
    // DataAdapter has no atomic create-if-absent API. Calls in this plugin
    // process are coalesced above; the first creation never overwrites an
    // existing UUID, while formalizing an existing identity always uses process.
    await writeAndVerifyFormalIdentity(adapter, path, vaultId);
    return { vaultId, created: true, absorbedPrototypeMarker: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await adapter.read(path));
  } catch (error) {
    throw new Error(`Cannot read existing vault identity: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isIdentityFile(parsed)) throw new Error("Existing vault-id.json has an unsupported schema or invalid vaultId; refusing to overwrite it");
  if (parsed.prototypeMarker === undefined) return { vaultId: parsed.vaultId, created: false, absorbedPrototypeMarker: false };
  if (parsed.prototypeMarker !== PROTOTYPE_MARKER) {
    throw new Error("Existing vault-id.json has an unknown marker; refusing to overwrite it");
  }
  await absorbPrototypeIdentity(adapter, path, parsed.vaultId);
  return { vaultId: parsed.vaultId, created: false, absorbedPrototypeMarker: true };
}

/** A successful write is not enough: keep the marked identity recoverable if it did not stick. */
async function writeAndVerifyFormalIdentity(adapter: VaultIdentityDataAdapter, path: string, vaultId: string): Promise<void> {
  await adapter.write(path, JSON.stringify({ schemaVersion: 1, vaultId }, null, 2));
  let written: unknown;
  try {
    written = JSON.parse(await adapter.read(path));
  } catch (error) {
    throw new Error(`Could not verify written vault identity: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isIdentityFile(written) || written.vaultId !== vaultId || written.prototypeMarker !== undefined) {
    throw new Error("Could not verify written vault identity; refusing to continue with an ambiguous identity");
  }
}

/**
 * Atomically absorbs only the exact prototype record observed before process.
 * Any concurrent edit, unknown marker, malformed JSON, or UUID change throws
 * from the callback, leaving the adapter's current content untouched.
 */
async function absorbPrototypeIdentity(adapter: VaultIdentityDataAdapter, path: string, vaultId: string): Promise<void> {
  const formal = JSON.stringify({ schemaVersion: 1, vaultId }, null, 2);
  await adapter.process(path, (current) => {
    const parsed = parseIdentityFile(current);
    if (!parsed || parsed.vaultId !== vaultId || parsed.prototypeMarker !== PROTOTYPE_MARKER) {
      throw new Error("Vault identity changed while absorbing the prototype marker; refusing to overwrite it");
    }
    return formal;
  });
  await verifyFormalIdentity(adapter, path, vaultId);
}

async function verifyFormalIdentity(adapter: VaultIdentityDataAdapter, path: string, vaultId: string): Promise<void> {
  let written: unknown;
  try {
    written = JSON.parse(await adapter.read(path));
  } catch (error) {
    throw new Error(`Could not verify written vault identity: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isIdentityFile(written) || written.vaultId !== vaultId || written.prototypeMarker !== undefined) {
    throw new Error("Could not verify written vault identity; refusing to continue with an ambiguous identity");
  }
}

function parseIdentityFile(value: string): IdentityFile | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isIdentityFile(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isIdentityFile(value: unknown): value is IdentityFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IdentityFile>;
  return candidate.schemaVersion === 1 && isUuid(candidate.vaultId) &&
    (candidate.prototypeMarker === undefined || typeof candidate.prototypeMarker === "string");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function joinVaultPath(left: string, right: string): string {
  return `${left.replace(/\\/g, "/").replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`;
}
