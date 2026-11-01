import type { ReplayTarget } from './model';

import { type DiagnosticRequest } from './source-diagnostics';

export interface ContentMessage {
  type: string;
  actionId?: string;
  y?: number;
  url?: string;
  request?: DiagnosticRequest;
  target?: ReplayTarget;
  expectedState?: string;
  generation?: string;
  segmentId?: string;
  event?: unknown;
  token?: string;
  mediaPlan?: unknown;
  stage?: 'before' | 'after';
}
