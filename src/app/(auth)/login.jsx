// Login entry (route "/login"). Iteration 1D.
// The WhatsApp OTP placeholder and dev shortcuts were removed from the
// user-facing flow. This route is now only a fallback target (e.g. admin
// route guards send unauthenticated/unauthorized users here) and simply
// redirects to the real email login screen.
// TODO(future): WhatsApp OTP / Google login are deferred, not implemented here.

import { Redirect } from 'expo-router';

export default function Login() {
  return <Redirect href="/email-login" />;
}
