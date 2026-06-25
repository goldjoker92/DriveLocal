// Mock users for Step 1 UI only. Replaced by Firestore in a later step.
// Phones are fake but use the real Brazilian +55 format.

import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

export const mockUsers = [
  {
    id: 'u_admin',
    name: 'Admin DriveLocal',
    phone: '+5585999990000',
    role: 'admin',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
  },
  {
    id: 'u_p1',
    name: 'Maria Souza',
    phone: '+5585999991111',
    role: 'passenger',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
  },
  {
    id: 'u_p2',
    name: 'João Lima',
    phone: '+5585999992222',
    role: 'passenger',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
  },
];
