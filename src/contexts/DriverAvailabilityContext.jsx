import { createContext, useContext } from 'react';

export const DriverAvailabilityContext = createContext({
  visibility: { state: 'checking', reason: 'profile_loading', ready: false, visible: true },
  recovering: false, recoveryError: '', recover: async () => {},
});
export function useDriverAvailability() { return useContext(DriverAvailabilityContext); }
