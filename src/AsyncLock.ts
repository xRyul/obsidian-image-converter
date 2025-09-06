// Helper class for async locking
export class AsyncLock {
    private locks: Map<string, Promise<void>> = new Map();

    async acquire(key: string, fn: () => Promise<void>) {
        const release = await this.acquireLock(key);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    private async acquireLock(key: string): Promise<() => void> {
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let resolve!: () => void;
        const promise = new Promise<void>(resolver => resolve = resolver);
        this.locks.set(key, promise);

        return () => {
            this.locks.delete(key);
            resolve();
        };
    }
}