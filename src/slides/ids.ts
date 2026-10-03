const ID_RANDOM_BASE = 36;
const ID_RANDOM_LENGTH = 8;

/** A fresh object id for a request that creates something and must refer to it later in the same batch. */
export const shortId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(ID_RANDOM_BASE)}${Math.random().toString(ID_RANDOM_BASE).slice(2, ID_RANDOM_LENGTH)}`;
