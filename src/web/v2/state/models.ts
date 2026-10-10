import { v2Host, v2Key } from './query';
export const modelsKey = (sessionId?: string) => v2Key(v2Host(), 'create', sessionId ?? 'host', sessionId, 'models');
