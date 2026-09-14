const { buildPolicyUpdate } = require('./set-minimum-driver-build');

describe('minimum driver build policy script', () => {
  it('maps the CLI build number to the persisted Firestore field', () => {
    const updatedAt = { serverTimestamp: true };

    expect(buildPolicyUpdate(17, false, updatedAt)).toEqual({
      minimumDriverBuildNumber: 17,
      enforceMinimumDriverBuild: false,
      driverBuildPolicyUpdatedAt: updatedAt,
    });
  });

  it('preserves an enabled enforcement flag for the later rollout step', () => {
    expect(buildPolicyUpdate(18, true, 'timestamp')).toMatchObject({
      minimumDriverBuildNumber: 18,
      enforceMinimumDriverBuild: true,
    });
  });
});
