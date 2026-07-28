const {
  formatCentavosBRL,
  getPassengerFirstName,
  isPassengerHistoryRide,
  passengerRideFareCentavos,
  passengerRidePointLabel,
  passengerRideStatusLabel,
  passengerRideVehicleLabel,
  sortPassengerRideHistory,
} = require('../passengerDashboardPolicy');

describe('passenger dashboard policy', () => {
  it('uses the first safe profile name for the greeting', () => {
    expect(getPassengerFirstName({ fullName: '  Guillaume   Ragot ' }, null)).toBe('Guillaume');
    expect(getPassengerFirstName({}, { displayName: 'Maria Silva' })).toBe('Maria');
    expect(getPassengerFirstName({}, {})).toBe('Passageiro');
  });

  it('keeps only terminal rides and sorts newest first', () => {
    const result = sortPassengerRideHistory([
      { rideId: 'old', status: 'completed', createdAtMs: 100 },
      { rideId: 'active', status: 'assigned', createdAtMs: 500 },
      { rideId: 'new', status: 'cancelled', createdAtMs: 300 },
    ]);

    expect(result.map((ride) => ride.rideId)).toEqual(['new', 'old']);
    expect(isPassengerHistoryRide({ status: 'dispatch_failed' })).toBe(true);
    expect(isPassengerHistoryRide({ status: 'in_progress' })).toBe(false);
  });

  it('formats stable PT-BR history labels without inventing values', () => {
    expect(passengerRideStatusLabel('completed')).toBe('Concluída');
    expect(passengerRideVehicleLabel('moto')).toBe('Moto');
    expect(passengerRideFareCentavos({ finalFareCentavos: 1325 })).toBe(1325);
    expect(formatCentavosBRL(1325)).toBe('R$ 13,25');
    expect(passengerRidePointLabel({ label: '  Centro  ' }, 'Fallback')).toBe('Centro');
    expect(passengerRidePointLabel(null, 'Fallback')).toBe('Fallback');
  });
});
