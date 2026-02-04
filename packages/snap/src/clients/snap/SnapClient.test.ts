import { isInterfaceNotFoundError, SnapClient } from './SnapClient';

// Mock the global snap object
const mockSnapRequest = jest.fn();
(globalThis as any).snap = {
  request: mockSnapRequest,
};

describe('SnapClient', () => {
  let snapClient: SnapClient;

  beforeEach(() => {
    snapClient = new SnapClient();
    mockSnapRequest.mockReset();
  });

  describe('isInterfaceNotFoundError', () => {
    it('returns true for errors with matching message pattern', () => {
      const error = new Error('Interface with id "abc" not found');

      expect(isInterfaceNotFoundError(error)).toBe(true);
    });

    it('returns true for case-insensitive matching', () => {
      const error = new Error('INTERFACE WITH ID NOT FOUND');

      expect(isInterfaceNotFoundError(error)).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      const error = new Error('Network connection failed');

      expect(isInterfaceNotFoundError(error)).toBe(false);
    });

    it('returns false for non-Error objects', () => {
      expect(isInterfaceNotFoundError('string error')).toBe(false);
      expect(isInterfaceNotFoundError(null)).toBe(false);
      expect(isInterfaceNotFoundError(undefined)).toBe(false);
      expect(isInterfaceNotFoundError(42)).toBe(false);
    });
  });

  describe('getInterfaceContext', () => {
    it('returns context when interface exists', async () => {
      const mockContext = { foo: 'bar' };
      mockSnapRequest.mockResolvedValue(mockContext);

      const result = await snapClient.getInterfaceContext('test-id');

      expect(result).toStrictEqual(mockContext);
      expect(mockSnapRequest).toHaveBeenCalledWith({
        method: 'snap_getInterfaceContext',
        params: { id: 'test-id' },
      });
    });

    it('returns null when interface is not found', async () => {
      mockSnapRequest.mockRejectedValue(
        new Error('Interface with id "xyz" not found'),
      );

      const result = await snapClient.getInterfaceContext('xyz');

      expect(result).toBeNull();
    });

    it('re-throws non-interface-not-found errors', async () => {
      const networkError = new Error('Network timeout');
      mockSnapRequest.mockRejectedValue(networkError);

      await expect(snapClient.getInterfaceContext('test-id')).rejects.toThrow(
        'Network timeout',
      );
    });
  });

  describe('updateInterface', () => {
    it('returns result when update succeeds', async () => {
      const mockResult = { success: true };
      mockSnapRequest.mockResolvedValue(mockResult);

      const result = await snapClient.updateInterface(
        'test-id',
        '<div>test</div>',
        { context: 'data' },
      );

      expect(result).toStrictEqual(mockResult);
      expect(mockSnapRequest).toHaveBeenCalledWith({
        method: 'snap_updateInterface',
        params: {
          id: 'test-id',
          ui: '<div>test</div>',
          context: { context: 'data' },
        },
      });
    });

    it('returns null when interface is not found', async () => {
      mockSnapRequest.mockRejectedValue(
        new Error('Interface with id "xyz" not found'),
      );

      const result = await snapClient.updateInterface(
        'xyz',
        '<div>test</div>',
        { context: 'data' },
      );

      expect(result).toBeNull();
    });

    it('re-throws non-interface-not-found errors', async () => {
      const networkError = new Error('Network timeout');
      mockSnapRequest.mockRejectedValue(networkError);

      await expect(
        snapClient.updateInterface('test-id', '<div>test</div>', {
          context: 'data',
        }),
      ).rejects.toThrow('Network timeout');
    });
  });
});
