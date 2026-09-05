import type { PanelFieldStatus } from '../state/deriveStatus.js';

/** Status badge: the class name doubles as the colour hook in panel.css. */
export function StatusBadge({ status }: { status: PanelFieldStatus }) {
  return (
    <span className={`badge badge--${status}`} data-status={status}>
      {status}
    </span>
  );
}
