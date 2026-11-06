import type { Address } from "../domain/address.js";

export interface AddressStore {
  ensureIndexes(): Promise<void>;
  count(userId: string): Promise<number>;
  list(userId: string): Promise<Address[]>;
  get(userId: string, id: string): Promise<Address | null>;
  /** Saves a new address. It becomes the default when asked, or when it is the customer's first; the old default is cleared in the same step. */
  insert(address: Address, makeDefault: boolean): Promise<Address>;
  save(address: Address): Promise<void>;
  /** Makes it the only default. False when the customer has no such address. */
  setDefault(userId: string, id: string, at: Date): Promise<boolean>;
  /** Removes it. If it was the default, the customer's newest remaining address becomes the default; that address's id is returned. */
  delete(userId: string, id: string, at: Date): Promise<{ deleted: Address | null; promoted: string | null }>;
  deleteAll(userId: string): Promise<Address[]>;
}

/** What an address needs from the media module (F24): take an uploaded file, or delete one. */
export interface AddressMedia {
  /** Checks the file is the customer's own, finished and of this kind, attaches it to the address, and returns a voice note's length. */
  claim(input: { mediaId: string; userId: string; kind: "address_voice" | "address_photo"; addressId: string }): Promise<{ durationSec: number | null }>;
  /** Lets go of a file claimed for an address that could not be saved, so the customer can use it again. */
  unclaim(mediaId: string, addressId: string): Promise<void>;
  release(mediaId: string, reason: string): Promise<void>;
  releaseAll(addressId: string, reason: string): Promise<void>;
}
