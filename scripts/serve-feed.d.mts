import type { Server } from 'node:http';
export const LATEST_CACHE: string;
export const IMMUTABLE_CACHE: string;
export function feedServer(directory: string): Server;
