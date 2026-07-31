# Acceptance checklist — closed test PROD

A release is accepted only when every item below is green.

- [ ] `drivelocal-prod` Email/Password provider enabled
- [ ] Firestore rules deployed from the reviewed `main` commit
- [ ] Firestore indexes deployed from the reviewed `main` commit
- [ ] Storage rules deployed from the reviewed `main` commit
- [ ] Firebase Functions deployed from the reviewed `main` commit
- [ ] Horizonte canonical config seeded without resetting operational data
- [ ] Fresh passenger Auth account created in PROD
- [ ] Passenger Firestore profile written and read in PROD
- [ ] Fresh driver Auth account created in PROD
- [ ] Driver Firestore profile written and read in PROD
- [ ] Temporary smoke-test accounts and profiles cleaned
- [ ] Closed-test app installed from Google Play
- [ ] Passenger signup works on the installed app
- [ ] Passenger logout/login works on the installed app
- [ ] Driver signup works on the installed app
- [ ] Driver logout/login works on the installed app

Do not publish a new AAB when one item is missing or red.
