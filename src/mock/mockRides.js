// Mock rides for Step 1 UI only. Replaced by Firestore in a later step.
//
// Each ride has TWO distinct locations:
//   pickup      -> where the driver must PICK UP the passenger
//                  (use pickup.lat / pickup.lng, show pickup.address)
//   destination -> where the driver must DROP OFF the passenger
//                  (use destination.lat / destination.lng, show destination.address)
//
// Coordinates are around Horizonte/CE, Brazil. Fares are integer cents.
// Payment in MVP 0.1 is "Pix direto ao motorista" (driver receives Pix directly).

import {
  RIDE_SEARCHING,
  RIDE_IN_PROGRESS,
  RIDE_COMPLETED,
} from '../constants/rideStatuses';
import { VEHICLE_MOTO, VEHICLE_CAR } from '../constants/vehicleTypes';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

export const mockRides = [
  {
    id: 'r1',
    passengerId: 'u_p1',
    passengerName: 'Maria Souza',
    driverId: 'd1',
    status: RIDE_IN_PROGRESS,
    vehicleType: VEHICLE_MOTO,
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    // pickup = go fetch the passenger here
    pickup: { address: 'Centro, Horizonte', lat: -4.0992, lng: -38.4958 },
    // destination = drive the passenger here
    destination: { address: 'Bairro Aurora, Horizonte', lat: -4.1105, lng: -38.4811 },
    fareCents: 1200,
    distanceMeters: 3400,
    paymentMethod: 'pix_direct',
    paymentStatus: 'pending', // placeholder until backend confirms
  },
  {
    id: 'r2',
    passengerId: 'u_p2',
    passengerName: 'João Lima',
    driverId: null,
    status: RIDE_SEARCHING,
    vehicleType: VEHICLE_CAR,
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    pickup: { address: 'Av. Nações Unidas, Horizonte', lat: -4.0951, lng: -38.4902 },
    destination: { address: 'Terminal Horizonte', lat: -4.1037, lng: -38.4969 },
    fareCents: 1800,
    distanceMeters: 5200,
    paymentMethod: 'pix_direct',
    paymentStatus: 'pending',
  },
  {
    id: 'r3',
    passengerId: 'u_p1',
    passengerName: 'Maria Souza',
    driverId: 'd2',
    status: RIDE_COMPLETED,
    vehicleType: VEHICLE_CAR,
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    pickup: { address: 'Escola Municipal, Horizonte', lat: -4.1008, lng: -38.4885 },
    destination: { address: 'Centro, Horizonte', lat: -4.0992, lng: -38.4958 },
    fareCents: 1500,
    distanceMeters: 4100,
    paymentMethod: 'pix_direct',
    paymentStatus: 'paid',
  },
];
