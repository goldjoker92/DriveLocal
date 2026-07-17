// Background tasks must be defined before the router mounts. Expo may load this
// entry point headlessly when Android delivers a location update in background.
import './src/services/driverLocationTracking';
import 'expo-router/entry';
