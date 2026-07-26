const mockGetDoc = jest.fn();
const mockGetDocFromCache = jest.fn();

jest.mock('firebase/firestore', () => ({
  getDoc: (...args) => mockGetDoc(...args),
  getDocFromCache: (...args) => mockGetDocFromCache(...args),
}));

const mockReportSnapshot = jest.fn();
const mockReportError = jest.fn();
jest.mock('../networkRecoveryService', () => ({
  reportFirestoreSnapshot: (...args) => mockReportSnapshot(...args),
  reportFirestoreListenerError: (...args) => mockReportError(...args),
}));

const { getDocumentWithCacheFallback } = require('../firestoreRecovery');

function unavailableError() {
  const error = new Error('offline');
  error.code = 'firestore/unavailable';
  return error;
}

function snapshot(fromCache, value = { activeRideId: 'ride-1' }) {
  return {
    metadata: { fromCache },
    exists: () => true,
    data: () => value,
  };
}

describe('Firestore cache recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the server snapshot when connectivity is available', async () => {
    const server = snapshot(false);
    mockGetDoc.mockResolvedValue(server);

    await expect(getDocumentWithCacheFallback({ path: 'passengers/u1' }, 'passenger_profile'))
      .resolves.toBe(server);
    expect(mockGetDocFromCache).not.toHaveBeenCalled();
    expect(mockReportSnapshot).toHaveBeenCalledWith('passenger_profile', { fromCache: false });
  });

  it('returns cache only after a connectivity failure', async () => {
    const error = unavailableError();
    const cached = snapshot(true);
    mockGetDoc.mockRejectedValue(error);
    mockGetDocFromCache.mockResolvedValue(cached);

    await expect(getDocumentWithCacheFallback({ path: 'passengers/u1' }, 'passenger_profile'))
      .resolves.toBe(cached);
    expect(mockReportError).toHaveBeenCalledWith('passenger_profile', error);
  });

  it('rethrows the original connectivity error when no cache exists', async () => {
    const error = unavailableError();
    mockGetDoc.mockRejectedValue(error);
    mockGetDocFromCache.mockRejectedValue(new Error('cache missing'));

    await expect(getDocumentWithCacheFallback({ path: 'passengers/u1' }, 'passenger_profile'))
      .rejects.toBe(error);
  });

  it('never masks a definitive permission error with cache', async () => {
    const error = new Error('denied');
    error.code = 'firestore/permission-denied';
    mockGetDoc.mockRejectedValue(error);

    await expect(getDocumentWithCacheFallback({ path: 'passengers/u1' }, 'passenger_profile'))
      .rejects.toBe(error);
    expect(mockGetDocFromCache).not.toHaveBeenCalled();
  });
});
