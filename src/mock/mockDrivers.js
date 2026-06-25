// Mock drivers for Step 1 UI only. Replaced by Firestore in a later step.
// Balances are integer cents. `commissionFreeUntil` / `subscriptionFreeUntil`
// are epoch-ms timestamps (0 = not set yet); real values are written by the
// approveDriver Cloud Function in a later step.

import { VEHICLE_MOTO, VEHICLE_CAR } from '../constants/vehicleTypes';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

export const mockDrivers = [
  {
    id: 'd1',
    name: 'Carlos Mendes',
    phone: '+5585988880001',
    vehicleType: VEHICLE_MOTO,
    plate: 'ABC1D23',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    approved: true,
    isFounder: true,
    balanceCents: 0,
    commissionFreeUntil: 0,
    subscriptionFreeUntil: 0,
    rating: 4.9,
  },
  {
    id: 'd2',
    name: 'Ana Pereira',
    phone: '+5585988880002',
    vehicleType: VEHICLE_CAR,
    plate: 'DEF2E34',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    approved: true,
    isFounder: false,
    balanceCents: 4500,
    commissionFreeUntil: 0,
    subscriptionFreeUntil: 0,
    rating: 4.7,
  },
  {
    id: 'd3',
    name: 'Pedro Alves',
    phone: '+5585988880003',
    vehicleType: VEHICLE_MOTO,
    plate: 'GHI3F45',
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    approved: false, // pending admin approval
    isFounder: false,
    balanceCents: 0,
    commissionFreeUntil: 0,
    subscriptionFreeUntil: 0,
    rating: 0,
  },
];
