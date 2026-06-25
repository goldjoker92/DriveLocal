// DriverStatusBadge
// Maps a driver's state to a colored AppBadge.
//   status: 'online' | 'offline' | 'pending'

import AppBadge from './AppBadge';

const STATUS_MAP = {
  online: { label: 'Online', tone: 'success' },
  offline: { label: 'Offline', tone: 'neutral' },
  pending: { label: 'Aguardando aprovação', tone: 'warning' },
};

export default function DriverStatusBadge({ status = 'offline' }) {
  const s = STATUS_MAP[status] || STATUS_MAP.offline;
  return <AppBadge label={s.label} tone={s.tone} />;
}
