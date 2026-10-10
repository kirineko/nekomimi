import { useQuery } from '@tanstack/react-query';
import type { DeliveriesView } from '../../../shared/handoff-view';
import type { SessionMode } from '../../../shared/protocol';
import { api } from '../../api';
import { v2Host, v2Key } from './query';
export const deliveryKey = (sessionId: string, mode: SessionMode) => v2Key(v2Host(), mode, 'handoff', sessionId, 'deliveries');
export function useDeliveries(sessionId: string, mode: SessionMode, enabled = true) {
  return useQuery({ queryKey: deliveryKey(sessionId, mode), enabled, retry: false,
    queryFn: ({ signal }) => api<DeliveriesView>(`/sessions/${sessionId}/deliveries`, undefined, signal) });
}
