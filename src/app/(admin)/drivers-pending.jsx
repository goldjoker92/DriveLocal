// Pending drivers (route "/(admin)/drivers-pending").
// Iteration 1C: the pending list is now a preset filter of the unified drivers
// list. This route is kept for backward-compatible links and simply redirects
// to /(admin)/drivers?status=pending_review so there is a single list screen.

import { Redirect } from 'expo-router';
import { VERIFICATION_STATUS } from '../../constants/driverStatuses';

export default function DriversPending() {
  return (
    <Redirect
      href={{ pathname: '/(admin)/drivers', params: { status: VERIFICATION_STATUS.PENDING_REVIEW } }}
    />
  );
}
