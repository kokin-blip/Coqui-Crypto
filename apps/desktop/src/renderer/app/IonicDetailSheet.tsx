import { IonModal, setupIonicReact } from '@ionic/react';
import type { ReactNode } from 'react';

setupIonicReact({ mode: 'md' });

export default function IonicDetailSheet({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}): React.JSX.Element {
  return <IonModal className="coqui-detail-sheet" isOpen initialBreakpoint={0.72} breakpoints={[0, 0.72, 1]} onDidDismiss={onClose} aria-labelledby="day-drawer-heading">{children}</IonModal>;
}
