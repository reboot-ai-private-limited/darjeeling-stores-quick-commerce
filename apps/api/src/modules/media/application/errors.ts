/** The store refused a second copy of the same address file onto the same order. */
export class DuplicateMediaError extends Error {
  constructor() { super("This file was already copied onto the order"); this.name = "DuplicateMediaError"; }
}
