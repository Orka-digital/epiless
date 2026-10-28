import { z } from 'zod';

export const identifier = z.string().min(1).max(128);

export const timestamp = z.iso.datetime({ offset: true });

export const finite = z.number().finite().nonnegative();

export const url = z
  .url()
  .max(4096)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Expected HTTP(S) URL');

export const dimension = z.number().int().positive().max(16384);

export const channel = z.number().int().min(0).max(255);
