import { IonPopover, setupIonicReact } from '@ionic/react';
import type { ReactNode } from 'react';

setupIonicReact({ mode: 'md' });

export default function IonicCommandPopover({
  anchor,
  children,
  onClose,
}: {
  readonly anchor: MouseEvent;
  readonly children: ReactNode;
  readonly onClose: () => void;
}): React.JSX.Element {
  return <IonPopover className="coqui-popover" isOpen event={anchor} onDidDismiss={onClose}>{children}</IonPopover>;
}
